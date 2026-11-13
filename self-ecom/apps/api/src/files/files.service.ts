// 作用：实现受限上传、会话与用途复核、主体配额、事务审计及公开/私有图片的受控读取。
import { Inject, Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileAccessService, type FileAccess } from './file-access.service.js';
import { FileBusinessAdapters } from './file-business-adapters.js';
import { FILE_CONFIG, type FileConfiguration } from './file-configuration.js';
import { fileNow } from './file-binding.service.js';
import { FileError, fileId } from './file.errors.js';
import { assertUploadPurpose, fileMetadata, ownerPolicies, uploadedBy } from './file-policy.js';
import { FileStorageService } from './file-storage.service.js';
import { encodeImage } from './image-codec.js';
import { receiveImage } from './multipart-upload.js';

@Injectable()
export class FilesService {
  private readonly rates = new Map<string, { start: number; count: number }>();
  private activeUploads = 0;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FileAccessService) private readonly access: FileAccessService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(FileBusinessAdapters) private readonly adapters: FileBusinessAdapters,
    @Inject(FileStorageService) private readonly storage: FileStorageService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FILE_CONFIG) private readonly config: FileConfiguration) {}

  private rate(actor: CurrentIdentity) {
    const now = Date.now(); const key = `${actor.subjectType}:${actor.subjectId}`;
    for (const [id, rate] of this.rates) if (now - rate.start >= 60000) this.rates.delete(id);
    let rate = this.rates.get(key);
    if (!rate) {
      if (this.rates.size >= 10000) throw new FileError('FILE_RATE_LIMITED', 60);
      rate = { start: now, count: 0 }; this.rates.set(key, rate);
    }
    if (rate.count >= this.config.uploadsPerMinute) throw new FileError('FILE_RATE_LIMITED', Math.max(1, Math.ceil((rate.start + 60000 - now) / 1000)));
    rate.count++;
  }
  private async quota(tx: Prisma.TransactionClient, actor: CurrentIdentity) {
    const count = await tx.fileAsset.count({ where: { state: 'STAGED',
      ...(actor.subjectType === 'CUSTOMER' ? { uploaderCustomerId: actor.subjectId } : { uploaderEmployeeId: actor.subjectId }) } });
    if (count >= this.config.stagedQuota) throw new FileError('FILE_QUOTA_EXCEEDED', 60);
  }
  async upload(request: IncomingMessage, access: FileAccess, requestId: string) {
    // 在接收文件字节前复核会话和当前配额；提交前在主体锁内再查，防止并发突破。
    const actor = await runAuthTransaction(this.prisma, async tx => {
      const current = await this.access.current(tx, access); await this.quota(tx, current); return current;
    });
    this.rate(actor);
    if (this.activeUploads >= 4) throw new FileError('FILE_RATE_LIMITED', 5);
    this.activeUploads++;
    let inputKey: string | undefined; let outputKey: string | undefined; let finalKey: string | undefined;
    try {
      const received = await receiveImage(request, this.storage, purpose => { assertUploadPurpose(actor, purpose); });
      inputKey = received.temporaryKey;
      const image = await encodeImage(await this.storage.read(inputKey));
      const output = await this.storage.temporary(); outputKey = output.key;
      try { await output.handle.writeFile(image.data); } finally { await output.handle.close(); }
      finalKey = await this.storage.publish(outputKey, image.extension); outputKey = undefined;
      const storageKey = finalKey;
      const asset = await runAuthTransaction(this.prisma, async tx => {
        const current = await this.access.current(tx, access); assertUploadPurpose(current, received.purpose); await this.quota(tx, current);
        const now = await fileNow(tx);
        const row = await tx.fileAsset.create({ data: {
          uploaderType: current.subjectType, uploaderEmployeeId: current.subjectType === 'EMPLOYEE' ? current.subjectId : null,
          uploaderCustomerId: current.subjectType === 'CUSTOMER' ? current.subjectId : null, purpose: received.purpose,
          storageKey, originalName: `image.${image.extension}`, mimeType: image.mimeType, byteSize: image.byteSize,
          width: image.width, height: image.height, sha256: image.sha256, createdAt: now, expiresAt: new Date(now.getTime() + 86400000),
        } });
        await this.audit.appendAudit(tx, { actor: { type: current.subjectType, id: current.subjectId }, action: 'file.upload', targetId: row.id, requestId,
          after: { purpose: row.purpose, mimeType: row.mimeType, byteSize: row.byteSize, width: row.width, height: row.height, sha256: row.sha256, state: 'STAGED' } });
        return row;
      });
      finalKey = undefined; return fileMetadata(asset);
    } finally {
      this.activeUploads--;
      for (const key of [inputKey, outputKey, finalKey]) if (key) await this.storage.compensate(key);
    }
  }

  private async identity(token: string) {
    try { return await this.identities.authenticate(this.prisma, token, 'EMPLOYEE'); }
    catch (error) {
      if (!(error instanceof TokenValidationError) || error.code !== 'TOKEN_SUBJECT_MISMATCH') throw error;
      return this.identities.authenticate(this.prisma, token, 'CUSTOMER');
    }
  }
  private async authorize(id: string, token: string | undefined, content: boolean) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: fileId(id) }, include: { references: true } });
    if (!asset || !['STAGED', 'RETAINED'].includes(asset.state)) throw new FileError('FILE_NOT_FOUND');
    const publicContent = content && asset.state === 'RETAINED' && asset.visibility === 'PUBLIC'
      && asset.references.some(ref => ref.audience === 'PUBLIC' && ownerPolicies[ref.ownerType].public
        && ownerPolicies[ref.ownerType].purpose === asset.purpose);
    if (publicContent) return { asset, publicContent: true };
    if (!token) throw new FileError('FILE_NOT_FOUND');
    const supplied = await this.identity(token);
    return this.prisma.$transaction(async tx => {
      let actor: CurrentIdentity;
      try { actor = await this.access.current(tx, { identity: supplied, token }); }
      catch (error) { if (error instanceof AccessDeniedError) throw new FileError('FILE_NOT_FOUND'); throw error; }
      if (asset.state === 'STAGED') {
        if (!uploadedBy(asset, actor) || !asset.expiresAt || asset.expiresAt <= await fileNow(tx)) throw new FileError('FILE_NOT_FOUND');
        try { assertUploadPurpose(actor, asset.purpose); } catch { throw new FileError('FILE_NOT_FOUND'); }
        return { asset, publicContent: false };
      }
      // 绑定后的读取必须重新走真实业务，上传人不再是永久通行证；无解析器或无权限均隐藏存在性。
      for (const reference of asset.references) {
        try {
          await this.adapters.get(reference.ownerType).authorize(tx, actor, reference, 'READ');
          return { asset, publicContent: false };
        } catch (error) {
          if (!(error instanceof FileError) && !(error instanceof AccessDeniedError)) throw error;
        }
      }
      throw new FileError('FILE_NOT_FOUND');
    });
  }
  async metadata(id: string, token?: string) { return fileMetadata((await this.authorize(id, token, false)).asset); }
  async content(id: string, token?: string) {
    const result = await this.authorize(id, token, true);
    try { return { ...result, data: await this.storage.read(result.asset.storageKey, result.asset.byteSize) }; }
    catch { throw new FileError('FILE_STORAGE_UNAVAILABLE'); }
  }
}
