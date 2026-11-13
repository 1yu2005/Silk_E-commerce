// 作用：按魔数识别允许格式，检查动画及像素，完整解码后重编码并去除EXIF等元数据。
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { FileError } from './file.errors.js';
import { MAX_IMAGE_BYTES } from './file-policy.js';

function format(input: Buffer): 'jpeg' | 'png' | 'webp' {
  if (input.length >= 3 && input[0] === 255 && input[1] === 216 && input[2] === 255) return 'jpeg';
  if (input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new FileError('FILE_TYPE_NOT_ALLOWED');
}
function rejectAnimation(input: Buffer, type: string) {
  // APNG默认解码只取首帧，因此在完整PNG块结构中显式拒绝acTL，不能只依赖pages。
  if (type === 'png') for (let offset = 8; offset + 12 <= input.length;) {
    const size = input.readUInt32BE(offset); const name = input.toString('ascii', offset + 4, offset + 8);
    if (name === 'acTL') throw new FileError('FILE_ANIMATION_NOT_ALLOWED');
    if (offset + size + 12 > input.length) throw new FileError('FILE_INVALID_IMAGE');
    offset += size + 12;
  }
  if (type === 'webp') for (let offset = 12; offset + 8 <= input.length;) {
    const name = input.toString('ascii', offset, offset + 4); const size = input.readUInt32LE(offset + 4);
    if (name === 'ANIM' || name === 'ANMF' || (name === 'VP8X' && size > 0 && (input[offset + 8]! & 2))) {
      throw new FileError('FILE_ANIMATION_NOT_ALLOWED');
    }
    if (offset + 8 + size > input.length) throw new FileError('FILE_INVALID_IMAGE');
    offset += 8 + size + size % 2;
  }
}
export async function encodeImage(input: Buffer) {
  if (!input.length) throw new FileError('FILE_INVALID_UPLOAD');
  if (input.length > MAX_IMAGE_BYTES) throw new FileError('FILE_TOO_LARGE');
  const type = format(input); rejectAnimation(input, type);
  try {
    const options = { failOn: 'warning' as const, limitInputPixels: 40000000, limitInputChannels: 4 };
    // 先以受限解码器读取元数据，随后toBuffer才完整解码，不把只读元数据当作验证成功。
    const metadata = await sharp(input, options).metadata();
    if (metadata.format !== type) throw new FileError('FILE_INVALID_IMAGE');
    if ((metadata.pages ?? 1) > 1) throw new FileError('FILE_ANIMATION_NOT_ALLOWED');
    if (!metadata.width || !metadata.height || metadata.width > 10000 || metadata.height > 10000
      || metadata.width * metadata.height > 40000000) throw new FileError('FILE_DIMENSIONS_EXCEEDED');
    const result = await sharp(input, options).autoOrient().toFormat(type).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
    if (!result.data.length || result.data.length > MAX_IMAGE_BYTES) throw new FileError('FILE_TOO_LARGE');
    return { data: result.data, mimeType: `image/${type}`, extension: type === 'jpeg' ? 'jpg' as const : type,
      byteSize: result.data.length, width: result.info.width, height: result.info.height,
      sha256: createHash('sha256').update(result.data).digest('hex') };
  } catch (error) {
    if (error instanceof FileError) throw error;
    // 解码器的原始错误可能含输入细节，只映射已知资源错误，其它统一损坏图片。
    throw new FileError(error instanceof Error && /pixel limit/i.test(error.message) ? 'FILE_DIMENSIONS_EXCEEDED' : 'FILE_INVALID_IMAGE');
  }
}
