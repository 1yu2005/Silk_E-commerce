// 作用：定义任务内核的明确拒绝结果；不将缺少真实领域接入伪装为成功。
const errors = {
  BUSINESS_MODULE_NOT_READY: [409, '任务对应业务尚未接入'],
  TASK_INPUT_INVALID: [400, '任务命令参数不合法'],
  TASK_STAGE_NOT_APPLICABLE: [409, '任务阶段不适用于当前业务'],
  TASK_STAGE_ACTIVE: [409, '当前阶段已有有效任务，须由业务确认结束后重入'],
  TASK_ENTRY_BLOCKED: [409, '当前业务状态不允许进入该任务阶段'],
  TASK_LOCK_PLAN_CHANGED: [409, '业务锁集合已变化，须回滚整个命令后重新定位'],
  TASK_CONTEXT_INVALID: [409, '任务命令必须使用当前已锁定的业务事务上下文'],
  TASK_NOT_FOUND: [404, '任务不存在或当前不可查看'],
  TASK_ALREADY_CLAIMED: [409, '任务已由其他员工领取'],
  TASK_NOT_OPEN: [409, '当前任务状态不能领取'],
  TASK_NOT_ASSIGNEE: [409, '当前不是该任务经办人'],
  TASK_RELEASE_BLOCKED: [409, '当前业务不能安全释放任务'],
  TASK_TRANSFER_BLOCKED: [409, '当前任务或业务不能安全转交'],
  TARGET_NOT_ELIGIBLE: [409, '目标员工当前不具备任务完整资格'],
  TASK_DEADLINE_BLOCKED: [409, '当前任务或业务阶段不支持人工延期'],
  TASK_DEADLINE_NOT_LATER: [409, '新截止必须晚于当前截止和服务器当前时间'],
  TASK_VERSION_EXHAUSTED: [409, '任务版本已达上限，需维护处理'],
  TASK_TRANSITION_BLOCKED: [409, '当前任务或业务条件不允许该状态变化'],
  TASK_SOURCE_ACTIVE: [409, '任务仍有未结束的业务来源'],
  TASK_SOURCE_CONFLICT: [409, '任务来源或重复动作参数不一致'],
  ORDER_TIMER_BLOCKED: [409, '当前订单或阻塞状态不允许该计时动作'],
  ORDER_TIMER_STATE_INVALID: [409, '订单暂停计时状态不一致'],
  ORDER_TIMER_COMMAND_CONFLICT: [409, '暂停计时重复动作参数不一致'],
  VERSION_CONFLICT: [409, '任务版本已更新，请重新确认'],
} as const;
export class TaskError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof errors) { super(errors[code][1]); this.name = 'TaskError'; this.status = errors[code][0]; }
}
