// 作用：以严格两段multipart流接收purpose和单张图片；先检查用途，再向随机临时文件写入受限内容。
import busboy from 'busboy';
import type { IncomingMessage } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FilePurpose } from '@prisma/client';
import { FileError } from './file.errors.js';
import { checkedPurpose, MAX_IMAGE_BYTES } from './file-policy.js';
import type { FileStorageService } from './file-storage.service.js';

export async function receiveImage(request: IncomingMessage, storage: FileStorageService, authorize: (purpose: FilePurpose) => void) {
  let purpose: FilePurpose | undefined; let files = 0; let failure: unknown; let temporaryKey: string | undefined;
  const jobs: Promise<void>[] = [];
  let parser;
  try { parser = busboy({ headers: request.headers, limits: { fileSize: MAX_IMAGE_BYTES + 1,
    files: 1, fields: 1, parts: 3, fieldSize: 100, fieldNameSize: 50, headerPairs: 30 } }); }
  catch { throw new FileError('FILE_INVALID_UPLOAD'); }
  const reject = (error: unknown = new FileError('FILE_INVALID_UPLOAD')) => { failure ??= error; };
  parser.on('field', (name, value, info) => {
    try {
      if (name !== 'purpose' || purpose || files || info.valueTruncated || info.nameTruncated) throw new FileError('FILE_INVALID_UPLOAD');
      purpose = checkedPurpose(value); authorize(purpose);
    } catch (error) { reject(error); }
  });
  parser.on('file', (name, file) => {
    files++;
    if (failure || !purpose || name !== 'file' || files !== 1) { reject(); file.resume(); return; }
    const job = (async () => {
      const temporary = await storage.temporary(); temporaryKey = temporary.key;
      let size = 0;
      const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length; callback(null, size > MAX_IMAGE_BYTES ? undefined : chunk);
      } });
      try {
        await pipeline(file, limit, temporary.handle.createWriteStream());
        if (file.truncated || size > MAX_IMAGE_BYTES) throw new FileError('FILE_TOO_LARGE');
        if (!size) throw new FileError('FILE_INVALID_UPLOAD');
      } finally { await temporary.handle.close(); }
    })();
    // 立即安装拒绝处理器，解析器结束后统一等待，避免流先失败引发未处理拒绝。
    jobs.push(job.catch(error => { reject(error); file.resume(); if (!file.readableEnded) parser.destroy(); }));
  });
  // busboy的partsLimit在达到上限时触发；设3才能让合法的两段通过，第三段仍由各项限制拒绝。
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit']) parser.on(event, () => { reject(); });
  let bodySize = 0;
  const bodyLimit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bodySize += chunk.length; callback(bodySize > 6 * 1024 * 1024 ? new FileError('FILE_TOO_LARGE') : null, chunk);
  } });
  const abort = () => { bodyLimit.destroy(new FileError('FILE_INVALID_UPLOAD')); };
  request.once('aborted', abort); request.once('error', abort);
  const timeout = setTimeout(abort, 30000); timeout.unref();
  try {
    // 不把IncomingMessage交给pipeline，避免格式错误时销毁socket而无法返回标准JSON。
    request.pipe(bodyLimit);
    await pipeline(bodyLimit, parser);
  } catch (error) { reject(error instanceof FileError ? error : new FileError('FILE_INVALID_UPLOAD')); }
  finally {
    clearTimeout(timeout); request.off('aborted', abort); request.off('error', abort);
    request.unpipe(bodyLimit); request.resume(); await Promise.all(jobs);
  }
  if (failure || files !== 1 || !purpose || !temporaryKey) {
    if (temporaryKey) await storage.compensate(temporaryKey);
    throw failure ?? new FileError('FILE_INVALID_UPLOAD');
  }
  return { purpose, temporaryKey };
}
