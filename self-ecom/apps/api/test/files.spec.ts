// 作用：用真实解码器与临时目录验证图片重编码、资源限制、受控路径和链接防护。
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { encodeImage } from '../src/files/image-codec.js';
import { FileStorageService } from '../src/files/file-storage.service.js';
import { loadConfiguration } from '../src/config/environment.js';
import { loadFileConfiguration } from '../src/files/file-configuration.js';

let directory = ''; let storage: FileStorageService;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'self-ecom-files-unit-'));
  storage = new FileStorageService({ ...loadConfiguration(), uploadDir: directory }); await storage.initialize();
});
afterAll(async () => {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !directory.includes('self-ecom-files-unit-')) throw new Error('拒绝清理非测试目录');
  console.log('保留测试临时目录：' + directory);
});
it.each(['jpeg', 'png', 'webp'] as const)('实际解码及重编码%s，剥离元数据并保持真实属性', async format => {
  const input = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#aabbcc' } }).toFormat(format)
    .withExif({ IFD0: { Artist: '不保留的测试元数据' } }).toBuffer();
  const result = await encodeImage(input); const metadata = await sharp(result.data).metadata();
  expect(result).toMatchObject({ width: 8, height: 6, mimeType: `image/${format}`, byteSize: result.data.length });
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/); expect(metadata.exif).toBeUndefined(); expect(metadata.format).toBe(format);
});
it.each([Buffer.from('<svg/>'), Buffer.from('GIF89a'), Buffer.from('伪装成PNG的文本')])('拒绝不允许的真实魔数%j', async input => {
  await expect(encodeImage(input)).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
});
it('拒绝空图、超5MiB、损坏及截断图', async () => {
  await expect(encodeImage(Buffer.alloc(0))).rejects.toMatchObject({ code: 'FILE_INVALID_UPLOAD' });
  await expect(encodeImage(Buffer.alloc(5242881))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  const valid = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#abcdef' } }).png().toBuffer();
  await expect(encodeImage(valid.subarray(0, 40))).rejects.toMatchObject({ code: 'FILE_INVALID_IMAGE' });
});
it('拒绝过宽及超总像素图片', async () => {
  const wide = await sharp({ create: { width: 10001, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  await expect(encodeImage(wide)).rejects.toMatchObject({ code: 'FILE_DIMENSIONS_EXCEEDED' });
  const large = await sharp({ create: { width: 6400, height: 6300, channels: 3, background: 'red' } }).png().toBuffer();
  await expect(encodeImage(large)).rejects.toMatchObject({ code: 'FILE_DIMENSIONS_EXCEEDED' });
});
it('显式拒绝APNG动画块及真实多帧WebP', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const control = Buffer.alloc(20); control.writeUInt32BE(8); control.write('acTL', 4);
  await expect(encodeImage(Buffer.concat([png.subarray(0, 33), control, png.subarray(33)])))
    .rejects.toMatchObject({ code: 'FILE_ANIMATION_NOT_ALLOWED' });
  const frames = Buffer.from([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0]);
  const webp = await sharp(frames, { raw: { width: 1, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(webp).metadata()).pages).toBe(2);
  await expect(encodeImage(webp)).rejects.toMatchObject({ code: 'FILE_ANIMATION_NOT_ALLOWED' });
});
it('随机临时写入、发布和删除；不存在文件删除幂等', async () => {
  const temp = await storage.temporary(); await temp.handle.writeFile('abc'); await temp.handle.close();
  const key = await storage.publish(temp.key, 'png'); expect(key).toMatch(/^objects\/[a-f0-9-]{36}\.png$/);
  expect((await storage.read(key, 3)).toString()).toBe('abc');
  await expect(storage.read(key, 4)).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });
  await storage.remove(key); await storage.remove(key);
});
it.each(['../../outside.png', 'objects/../outside.png', 'C:\\secret.png', '/tmp/secret', 'objects/link.png'])('拒绝非法存储键%s', async key => {
  await expect(storage.read(key)).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });
  await expect(storage.remove(key)).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });
});
it('固定目录的junction链接不能被读取、删除或扫描穿透', async () => {
  const outside = join(directory, 'outside'); const linked = join(directory, 'linked');
  await import('node:fs/promises').then(fs => fs.mkdir(outside)); await writeFile(join(outside, 'sentinel'), '保留');
  await import('node:fs/promises').then(fs => fs.mkdir(linked)); await symlink(outside, join(linked, 'objects'), 'junction');
  const guarded = new FileStorageService({ ...loadConfiguration(), uploadDir: linked });
  await expect(guarded.initialize()).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });
  expect((await import('node:fs/promises').then(fs => fs.readFile(join(outside, 'sentinel'), 'utf8')))).toBe('保留');
});
it.each(['0', '-1', '1001', '1e2', ''])('严格拒绝非法未绑定配额%s', FILE_STAGED_QUOTA => {
  expect(() => loadFileConfiguration({ FILE_STAGED_QUOTA })).toThrow('FILE_STAGED_QUOTA');
});
