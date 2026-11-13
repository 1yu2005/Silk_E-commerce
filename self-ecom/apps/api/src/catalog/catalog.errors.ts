// 作用：商品领域使用固定业务错误，既不泄漏SQL也不把失败转换为成功。
const messages = {
  CATEGORY_NOT_FOUND: '分类不存在', CATEGORY_IN_USE: '分类仍有子分类或关联商品', CATEGORY_NAME_EXISTS: '同级分类名称已存在',
  CATEGORY_CYCLE: '分类不能移动到自身或后代', CATEGORY_DEPTH_EXCEEDED: '移动后的分类不能超过三级',
  PRODUCT_NOT_FOUND: '商品不存在或不可查看', SKU_NOT_FOUND: '款式不存在或不属于当前商品',
  VERSION_CONFLICT: '资料已更新，请重新读取后确认', PRODUCT_ARCHIVED: '商品已归档',
  PRODUCT_MUST_UNPUBLISH: '请先下架再清除销售所需资料', PRODUCT_NOT_PUBLISHABLE: '商品尚不满足上架条件',
  SKU_COMBINATION_LIMIT: '最多3个规格、每规格20个值、200个组合', SKU_CODE_EXISTS: 'SKU编号已存在',
  SKU_COMBINATION_EXISTS: '规格组合已存在', SKU_SCHEME_REFERENCED: '规格已被引用或存在库存、非零数量草稿，不能重建',
  SKU_PRICE_REQUIRED: '销售或已被引用的SKU不能清空售价', INITIAL_DRAFT_NOT_EDITABLE: '数量草稿已转换或作废，不能修改',
  SKU_REFERENCE_NOT_READY: '已安装业务领域尚未注册SKU引用检查器', VALIDATION_FAILED: '请求参数不合法',
} as const;
export type CatalogCode = keyof typeof messages;
export class CatalogError extends Error {
  readonly status: number;
  readonly details?: {field:string;message:string}[];
  constructor(readonly code: CatalogCode, details?: Record<string, unknown>) {
    super(messages[code]); this.name = 'CatalogError';
    const fields=details?.fields;
    if(Array.isArray(fields)){
      const messages:Record<string,string>={category:'请选择有效分类',mainImage:'请上传并保存主图',price:'请填写全部启用SKU的有效售价',availableStock:'可售库存不足，请完成库存登记确认'};
      this.details=fields.filter((f):f is string=>typeof f==='string'&&Object.hasOwn(messages,f)).map(field=>({field,message:messages[field]!}));
    }
    this.status = code === 'VALIDATION_FAILED' || code === 'SKU_COMBINATION_LIMIT' ? 400 : code.endsWith('NOT_FOUND') ? 404 : 409;
  }
}
