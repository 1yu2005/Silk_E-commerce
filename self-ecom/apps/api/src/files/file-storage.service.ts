// 作用：管理固定上传根目录下的随机文件；拒绝链接、路径穿越和非普通文件，不开放静态目录。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import { FileError } from './file.errors.js';

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  readonly root: string;
  constructor(@Inject(APP_CONFIG) config: EnvironmentConfig) { this.root = resolve(config.uploadDir); }

  async initialize() {
    // 配置根目录及固定子目录均不允许符号链接；不跟随运维误配的公开目录链接。
    await this.assertDirectory(this.root, true);
    for (const child of ['tmp', 'objects']) await this.assertDirectory(join(this.root, child), true);
  }
  private async assertDirectory(path: string, create = false) {
    const parts = relative(parse(path).root, path).split(/[\\/]/).filter(Boolean);
    let current = parse(path).root;
    for (const part of parts) {
      current = join(current, part);
      try { const stat = await lstat(current); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new FileError('FILE_STORAGE_UNAVAILABLE'); }
      catch (error) {
        if (create && isMissing(error)) await mkdir(current, { mode: 0o700 }).catch(async failure => {
          if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure;
        }); else throw error;
        const stat = await lstat(current); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new FileError('FILE_STORAGE_UNAVAILABLE');
      }
    }
  }
  private async path(key: string) {
    if (!/^(tmp\/[0-9a-f-]{36}\.part|objects\/[0-9a-f-]{36}\.(jpg|png|webp))$/.test(key)) throw new FileError('FILE_STORAGE_UNAVAILABLE');
    const path = resolve(this.root, key);
    if (relative(this.root, path).startsWith('..')) throw new FileError('FILE_STORAGE_UNAVAILABLE');
    await this.assertDirectory(dirname(path));
    return path;
  }
  async temporary() {
    await this.initialize();
    const key = `tmp/${randomUUID()}.part`; const path = await this.path(key);
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    return { key, path, handle };
  }
  async read(key: string, expectedSize?: number) {
    const path = await this.path(key); const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 5242880 || (expectedSize !== undefined && stat.size !== expectedSize)) {
      throw new FileError('FILE_STORAGE_UNAVAILABLE');
    }
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size !== stat.size || opened.ino !== stat.ino) throw new FileError('FILE_STORAGE_UNAVAILABLE');
      return await handle.readFile();
    } finally { await handle.close(); }
  }
  async publish(tempKey: string, extension: 'jpg' | 'png' | 'webp') {
    const source = await this.path(tempKey); const stat = await lstat(source);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new FileError('FILE_STORAGE_UNAVAILABLE');
    const key = `objects/${randomUUID()}.${extension}`;
    await rename(source, await this.path(key)); return key;
  }
  async remove(key: string) {
    const path = await this.path(key);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new FileError('FILE_STORAGE_UNAVAILABLE');
      await unlink(path);
    } catch (error) { if (!isMissing(error)) throw error; }
  }
  async compensate(key: string) {
    try { await this.remove(key); } catch { this.logger.warn('文件补偿删除失败，等待保守孤儿扫描'); }
  }
  async orphanCandidates(before: Date) {
    await this.initialize(); const keys: string[] = [];
    for (const directory of ['tmp', 'objects']) for (const name of await readdir(join(this.root, directory))) {
      const key = `${directory}/${name}`;
      try {
        const path = await this.path(key); const stat = await lstat(path);
        if (!stat.isSymbolicLink() && stat.isFile() && stat.mtime < before) keys.push(key);
      } catch { /* 不认识的文件、链接及子目录留给人工核对。 */ }
    }
    return keys;
  }
}
export function isMissing(error: unknown) { return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'; }
