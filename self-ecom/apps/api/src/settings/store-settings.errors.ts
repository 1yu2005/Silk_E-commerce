// 作用：定义设置领域的固定脱敏错误，不回显地址、电话或数据库异常。
const definitions = {
  VERSION_CONFLICT: [409, '全店设置已更新，请刷新后重试'],
  SETTING_VERSION_NOT_FOUND: [404, '设置版本不存在'],
  STORE_NOT_CONFIGURED: [409, '全店设置尚未完成，请联系管理员'],
} as const;
export class StoreSettingsError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof definitions) {
    super(definitions[code][1]); this.name = 'StoreSettingsError'; this.status = definitions[code][0];
  }
}
