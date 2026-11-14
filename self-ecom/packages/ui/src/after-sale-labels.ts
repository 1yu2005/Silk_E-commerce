// 作用：售后阶段与任务的公共中文展示。
export const afterSaleLabels:Record<string,string>={PENDING_REVIEW:'待审核',WAIT_SUPPLEMENT:'待补充材料',WAIT_FULFILLMENT_CHECK:'待交运或实物核实',WAIT_REFUND:'待办理退款',WAIT_RETURN:'待寄回',WAIT_RECEIPT:'待收包',WAIT_INSPECTION:'待验收',INSPECTION_EXCEPTION:'验收异常',FINAL_INSPECTION:'已最终验收',REFUNDING:'退款处理中',REFUND_FAILED:'退款失败待处理',REJECTED:'已拒绝',WITHDRAWN:'已撤销',CLOSED:'已关闭',SUCCEEDED:'售后成功'};
export const saleTaskLabels:Record<string,string>={AFTER_SALE_REVIEW:'售后审核',SUPPLEMENT_FOLLOW:'补充材料跟进',RETURN_FOLLOW:'寄回跟进',RETURN_RECEIVE:'退货收包',REFUND_PROCESS:'退款办理'};
export const saleTime=(v:string|null|undefined)=>v?new Date(v).toLocaleString('zh-CN'):'无';
