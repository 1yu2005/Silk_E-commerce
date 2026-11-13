// 作用：定义文件领域的脱敏错误，统一由HTTP过滤器输出，不附带磁盘路径或输入内容。
const definitions = {
  FILE_NOT_FOUND: [404, '文件不存在或无权读取'],
  FILE_TOO_LARGE: [413, '图片不能超过5MiB'],
  FILE_TYPE_NOT_ALLOWED: [400, '仅支持JPEG、PNG和WebP图片'],
  FILE_INVALID_IMAGE: [400, '图片损坏或无法解码'],
  FILE_DIMENSIONS_EXCEEDED: [400, '图片尺寸或总像素超限'],
  FILE_ANIMATION_NOT_ALLOWED: [400, '不支持动画图片'],
  FILE_INVALID_UPLOAD: [400, '请先提交purpose，再提交一个非空file，不得包含其它字段'],
  FILE_RATE_LIMITED: [429, '图片上传过于频繁'],
  FILE_QUOTA_EXCEEDED: [429, '未绑定图片数量已达上限'],
  FILE_PURPOSE_MISMATCH: [409, '图片用途与业务要求不符'],
  FILE_NOT_BINDABLE: [409, '图片已过期、正在清理或不能用于该业务'],
  FILE_INVALID_BINDING: [400, '图片引用参数不合法'],
  FILE_BUSINESS_NOT_READY: [409, '对应业务尚未接入文件管理'],
  FILE_STORAGE_UNAVAILABLE: [503, '图片存储暂不可用'],
} as const;
export class FileError extends Error {
  readonly status: number;
  constructor(public readonly code: keyof typeof definitions, public readonly retryAfterSeconds?: number) {
    super(definitions[code][1]); this.name = 'FileError'; this.status = definitions[code][0];
  }
}
export function fileId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new FileError('FILE_NOT_FOUND');
  return value.toLowerCase();
}
