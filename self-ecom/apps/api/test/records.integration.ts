// 作用：以真实会话和隔离PostgreSQL临时业务夹具验证公共记录的归属、公开投影、追加更正与事务回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { BusinessAggregateType, CommunicationScopeType, Prisma } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { AuditService, type AuditActor, type AuditPayload } from '../src/audit/audit.service.js';
import { CurrentIdentityService, type CurrentIdentity } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { ConfigModule } from '../src/config/config.module.js';
import { loadConfiguration } from '../src/config/environment.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { BusinessRecordAdapters, type CommunicationAccessMode, type StateTransition } from '../src/records/business-record-adapters.js';
import { CommunicationService, type CommunicationAccess, type CommunicationInput } from '../src/records/communication.service.js';
import { BusinessModuleNotReadyError, RecordInputError } from '../src/records/record-support.js';
import { RecordsModule } from '../src/records/records.module.js';
import { StateHistoryService } from '../src/records/state-history.service.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
const prisma = new PrismaService(loadConfiguration());
const tokens = new JwtTokenService({ secret: 'records-integration-only-secret-'.repeat(2), ttlSeconds: 7200 });
const identities = new CurrentIdentityService(tokens, new PermissionService());
const audit = new AuditService();
beforeAll(async () => { await prisma.onModuleInit(); });
afterAll(async () => { await prisma.$disconnect(); });
const past = new Date('2026-01-01T00:00:00.000Z');
const rollback = new Error('本项测试主动回滚');

interface Fact { customer_id: string; assignee_id: string; state: string }
async function fact(tx: Prisma.TransactionClient, id: string, kind: string): Promise<Fact> {
  const [row] = await tx.$queryRaw<Fact[]>`SELECT customer_id,assignee_id,state FROM record_contract_fixture
    WHERE id=${id}::uuid AND kind=${kind} FOR UPDATE`;
  if (!row) throw new Error('测试业务不存在');
  return row;
}
// 只在本文件中注册；查真实事务临时表，不用恒返回允许的生产占位适配器。
function scopeAdapter(type: CommunicationScopeType) {
  return { scopeType: type, async lockAndAuthorize(tx: Prisma.TransactionClient, actor: CurrentIdentity, id: string, mode: CommunicationAccessMode) {
    const row = await fact(tx, id, type);
    if (mode === 'PUBLIC_READ') {
      if (actor.subjectType !== 'CUSTOMER' || actor.subjectId !== row.customer_id) throw new Error('测试业务归属拒绝');
    } else if (actor.subjectType !== 'EMPLOYEE' || (actor.role !== 'SUPER_ADMIN' && actor.subjectId !== row.assignee_id)) {
      throw new Error('测试经办人拒绝');
    }
  } };
}
function stateAdapter(type: BusinessAggregateType) {
  return { aggregateType: type, async lockAndValidate(tx: Prisma.TransactionClient, actor: AuditActor, input: Readonly<StateTransition>) {
    const row = await fact(tx, input.aggregateId, type);
    if ((actor.type === 'EMPLOYEE' && actor.id !== row.assignee_id) || (actor.type === 'CUSTOMER' && actor.id !== row.customer_id)) {
      throw new Error('测试状态主体拒绝');
    }
    if (input.dimension !== 'main' || (input.fromState === null ? input.toState !== row.state
      : input.fromState !== row.state || input.toState !== 'CONFIRMED')) throw new Error('测试状态迁移拒绝');
  } };
}
function configured() {
  const adapters = new BusinessRecordAdapters();
  for (const type of ['ORDER', 'AFTER_SALE'] as const) adapters.registerCommunication(scopeAdapter(type));
  for (const type of ['ORDER', 'FULFILLMENT', 'AFTER_SALE'] as const) adapters.registerStateHistory(stateAdapter(type));
  return adapters;
}
async function actor(tx: Prisma.TransactionClient, subjectType: 'EMPLOYEE' | 'CUSTOMER', subjectId: string): Promise<CommunicationAccess> {
  const sessionId = randomUUID(); const issued = await tokens.issue({ subjectType, subjectId, sessionId, tokenVersion: 0 });
  await tx.authSession.create({ data: { id: sessionId, subjectType, tokenVersion: 0,
    employeeId: subjectType === 'EMPLOYEE' ? subjectId : null, customerId: subjectType === 'CUSTOMER' ? subjectId : null,
    createdAt: issued.issuedAt, expiresAt: issued.expiresAt } });
  return { identity: await identities.authenticate(tx, issued.accessToken, subjectType), token: issued.accessToken };
}
async function fixture(tx: Prisma.TransactionClient) {
  const employeeId = randomUUID(); const customerId = randomUUID(); const otherCustomerId = randomUUID();
  await tx.employee.create({ data: { id: employeeId, username: `r_${employeeId.replaceAll('-', '').slice(0, 20)}`,
    displayName: '记录测试客服', passwordHash: '本夹具仅验证会话授权，密码登录另有真实bcrypt回归',
    role: 'CUSTOMER_SERVICE', mustChangePassword: false, createdAt: past } });
  for (const id of [customerId, otherCustomerId]) await tx.customer.create({ data: { id,
    phone: `139${String(BigInt('0x' + id.replaceAll('-', '').slice(0, 12)) % 100000000n).padStart(8, '0')}`,
    nickname: '记录测试顾客', passwordHash: '仅验证会话授权的夹具', createdAt: past } });
  await tx.$executeRaw`CREATE TEMP TABLE record_contract_fixture
    (id uuid NOT NULL, kind text NOT NULL, customer_id uuid NOT NULL, assignee_id uuid NOT NULL, state text NOT NULL,
    PRIMARY KEY (id,kind)) ON COMMIT DROP`;
  const orderId = randomUUID(); const afterSaleId = randomUUID();
  for (const [id, kind] of [[orderId, 'ORDER'], [orderId, 'FULFILLMENT'], [afterSaleId, 'AFTER_SALE']]) {
    await tx.$executeRaw`INSERT INTO record_contract_fixture VALUES (${id}::uuid,${kind},${customerId}::uuid,${employeeId}::uuid,'CREATED')`;
  }
  const staff = await actor(tx, 'EMPLOYEE', employeeId); const customer = await actor(tx, 'CUSTOMER', customerId);
  const otherCustomer = await actor(tx, 'CUSTOMER', otherCustomerId);
  const adapters = configured();
  return { employeeId, customerId, orderId, afterSaleId, staff, customer, otherCustomer, adapters,
    communication: new CommunicationService(identities, adapters, audit), history: new StateHistoryService(adapters) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function transaction(run: (tx: Prisma.TransactionClient, context: Fixture) => Promise<void>) {
  await expect(prisma.$transaction(async tx => { await run(tx, await fixture(tx)); throw rollback; }, { timeout: 15000 })).rejects.toBe(rollback);
}
function input(context: Fixture, changes: Partial<CommunicationInput> = {}): CommunicationInput {
  return { scopeType: 'ORDER', scopeId: context.orderId, channel: 'PHONE', occurredAt: past,
    result: '内部：核对服装颜色与尺码', nextStep: '内部：联系仓库核实', publicText: null, requestId: randomUUID(), ...changes };
}
function transition(context: Fixture, changes: Partial<StateTransition> = {}): StateTransition {
  return { aggregateType: 'ORDER', aggregateId: context.orderId, dimension: 'main', commandKey: randomUUID(),
    fromState: 'CREATED', toState: 'CONFIRMED', requestId: randomUUID(), ...changes };
}

it('追加内部沟通及最小审计；作者取当前会话，公开说明不从内部文字生成', async () => {
  await transaction(async (tx, f) => {
    const command = input(f); const created = await f.communication.appendCommunication(tx, f.staff, command);
    const row = await tx.communication.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ authorEmployeeId: f.employeeId, result: command.result, nextStep: command.nextStep, publicText: null });
    const log = await tx.auditLog.findFirstOrThrow({ where: { targetId: created.id } });
    expect(log).toMatchObject({ action: 'communication.append', actorEmployeeId: f.employeeId,
      afterData: { scopeType: 'ORDER', scopeId: f.orderId, channel: 'PHONE', hasPublicText: false } });
    expect(JSON.stringify(log)).not.toContain(command.result);
    expect((await f.communication.readPublicCommunication(tx, f.customer, { scopeType: command.scopeType, scopeId: command.scopeId })).total).toBe(0);
  });
});

it('公开投影只含允许字段，跨页保留公开更正关系，内部原文及员工ID不进入响应', async () => {
  await transaction(async (tx, f) => {
    const first = await f.communication.appendCommunication(tx, f.staff, input(f, { publicText: '尺码待确认' }));
    const correction = await f.communication.appendCommunication(tx, f.staff, input(f, {
      publicText: '已与顾客确认L码', correctsId: first.id, correctionReason: '补充正确尺码',
    }));
    await f.communication.appendCommunication(tx, f.staff, input(f));
    const target = { scopeType: 'ORDER' as const, scopeId: f.orderId };
    const result = await f.communication.readPublicCommunication(tx, f.customer, target, { pageSize: 1, page: 1 });
    const second = await f.communication.readPublicCommunication(tx, f.customer, target, { pageSize: 1, page: 2 });
    expect(result.total).toBe(2); expect(second.total).toBe(2);
    const all = [...result.items, ...second.items];
    expect(all.find(row => row.id === first.id)).toMatchObject({ publicText: '尺码待确认', isCorrected: true });
    expect(all.find(row => row.id === correction.id)).toMatchObject({ correctsId: first.id, publicText: '已与顾客确认L码' });
    for (const row of all) expect(Object.keys(row).sort()).toEqual(['attachments', 'correctsId', 'createdAt', 'id', 'isCorrected', 'occurredAt', 'publicText']);
    const serialized = JSON.stringify(all);
    for (const hidden of [f.employeeId, '内部：', 'correctionReason', 'authorEmployeeId', 'nextStep']) expect(serialized).not.toContain(hidden);
    const internal = await f.communication.readInternalCommunication(tx, f.staff, target);
    expect(internal.total).toBe(3); expect(internal.items[0]).toHaveProperty('result');
  });
});

it('私有原记录转公开更正时，不泄露私有原记录ID', async () => {
  await transaction(async (tx, f) => {
    const original = await f.communication.appendCommunication(tx, f.staff, input(f));
    const correction = await f.communication.appendCommunication(tx, f.staff, input(f, { correctsId: original.id,
      correctionReason: '形成对外说明', publicText: '该款服装信息已确认' }));
    const result = await f.communication.readPublicCommunication(tx, f.customer, { scopeType: 'ORDER', scopeId: f.orderId });
    expect(result.items).toHaveLength(1); expect(result.items[0]).toMatchObject({ id: correction.id, correctsId: null });
    expect(JSON.stringify(result)).not.toContain(original.id);
  });
});

it('沟通记录有效大页码返回空页，不把超出Prisma整数范围的偏移传给数据库', async () => {
  await transaction(async (tx, f) => {
    await f.communication.appendCommunication(tx, f.staff, input(f, { publicText: '测试公开说明' }));
    const target = { scopeType: 'ORDER' as const, scopeId: f.orderId };
    const pagination = { page: 2147483647, pageSize: 100 };
    const publicResult = await f.communication.readPublicCommunication(tx, f.customer, target, pagination);
    const internalResult = await f.communication.readInternalCommunication(tx, f.staff, target, pagination);
    for (const result of [publicResult, internalResult]) {
      expect(result).toMatchObject({ ...pagination, total: 1, items: [] });
    }
  });
});

it('沟通业务锁等待跨过JWT到期后拒绝写入，不追加沟通或审计', async () => {
  await transaction(async (tx, f) => {
    let now = new Date();
    const clock = () => new Date(now);
    const expiringTokens = new JwtTokenService({ secret: 'record-expiry-regression-only-'.repeat(2), ttlSeconds: 60 }, clock);
    const expiringIdentities = new CurrentIdentityService(expiringTokens, new PermissionService(), clock);
    const sessionId = randomUUID();
    const issued = await expiringTokens.issue({ subjectType: 'EMPLOYEE', subjectId: f.employeeId, sessionId, tokenVersion: 0 });
    await tx.authSession.create({ data: { id: sessionId, subjectType: 'EMPLOYEE', employeeId: f.employeeId,
      tokenVersion: 0, createdAt: issued.issuedAt, expiresAt: issued.expiresAt } });
    const identity = await expiringIdentities.authenticate(tx, issued.accessToken, 'EMPLOYEE');
    const adapters = new BusinessRecordAdapters();
    adapters.registerCommunication({ scopeType: 'ORDER', async lockAndAuthorize(db, actor, id, mode) {
      await scopeAdapter('ORDER').lockAndAuthorize(db, actor, id, mode);
      now = new Date(issued.expiresAt);
    } });
    const service = new CommunicationService(expiringIdentities, adapters, audit);
    const beforeAudit = await tx.auditLog.count();
    await expect(service.appendCommunication(tx, { identity, token: issued.accessToken }, input(f)))
      .rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(await tx.communication.count({ where: { scopeId: f.orderId } })).toBe(0);
    expect(await tx.auditLog.count()).toBe(beforeAudit);
  });
});

it('公开记录不能仅在内部更正，原公开内容及数据库旧记录不被改写', async () => {
  await transaction(async (tx, f) => {
    const original = await f.communication.appendCommunication(tx, f.staff, input(f, { publicText: '原公开说明' }));
    const before = await tx.communication.findUniqueOrThrow({ where: { id: original.id } });
    await expect(f.communication.appendCommunication(tx, f.staff, input(f, {
      correctsId: original.id, correctionReason: '更正', publicText: null,
    }))).rejects.toThrow('公开记录更正须填写公开说明');
    expect(await tx.communication.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
    expect(await tx.communication.count({ where: { scopeId: f.orderId } })).toBe(1);
  });
});

it.each(['other-scope', 'other-type', 'missing'] as const)('拒绝更正%s中的记录', async mode => {
  await transaction(async (tx, f) => {
    const original = await f.communication.appendCommunication(tx, f.staff, input(f));
    let command = input(f, { correctsId: original.id, correctionReason: '更正' });
    if (mode === 'other-scope') {
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO record_contract_fixture VALUES (${id}::uuid,'ORDER',${f.customerId}::uuid,${f.employeeId}::uuid,'CREATED')`;
      command = { ...command, scopeId: id };
    }
    if (mode === 'other-type') command = { ...command, scopeType: 'AFTER_SALE', scopeId: f.afterSaleId };
    if (mode === 'missing') command = { ...command, correctsId: randomUUID() };
    await expect(f.communication.appendCommunication(tx, f.staff, command)).rejects.toThrow('更正对象必须为同一业务下的已有沟通记录');
  });
});

it.each(['foreign-customer', 'warehouse', 'stale-permission', 'revoked-session', 'frozen-customer', 'password-required', 'missing-business', 'wrong-assignee'] as const)('从当前会话和真实业务夹具拒绝%s', async mode => {
  await transaction(async (tx, f) => {
    const target = { scopeType: 'ORDER' as const, scopeId: f.orderId };
    if (mode === 'foreign-customer') {
      await expect(f.communication.readPublicCommunication(tx, f.otherCustomer, target)).rejects.toThrow('测试业务归属拒绝');
    } else if (mode === 'frozen-customer') {
      await tx.customer.update({ where: { id: f.customerId }, data: { status: 'LOGIN_FROZEN' } });
      await expect(f.communication.readPublicCommunication(tx, f.customer, target)).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
    } else if (mode === 'warehouse' || mode === 'stale-permission') {
      await tx.employee.update({ where: { id: f.employeeId }, data: { role: 'MERCH_WAREHOUSE' } });
      const request = mode === 'warehouse' ? f.communication.readInternalCommunication(tx, f.staff, target)
        : f.communication.appendCommunication(tx, f.staff, input(f));
      await expect(request).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } else if (mode === 'revoked-session') {
      await tx.authSession.update({ where: { id: f.staff.identity.sessionId }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } });
      await expect(f.communication.appendCommunication(tx, f.staff, input(f))).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    } else if (mode === 'password-required') {
      await tx.employee.update({ where: { id: f.employeeId }, data: { mustChangePassword: true } });
      await expect(f.communication.appendCommunication(tx, f.staff, input(f))).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    } else if (mode === 'missing-business') {
      await expect(f.communication.appendCommunication(tx, f.staff, input(f, { scopeId: randomUUID() }))).rejects.toThrow('测试业务不存在');
    } else {
      await tx.$executeRaw`UPDATE record_contract_fixture SET assignee_id=${randomUUID()}::uuid WHERE id=${f.orderId}::uuid`;
      await expect(f.communication.appendCommunication(tx, f.staff, input(f))).rejects.toThrow('测试经办人拒绝');
    }
    expect(await tx.communication.count({ where: { scopeId: f.orderId } })).toBe(0);
  });
});

it('交易受限顾客仍可读本人公开说明；伪造会话主体和顾客写入被拒绝', async () => {
  await transaction(async (tx, f) => {
    await f.communication.appendCommunication(tx, f.staff, input(f, { publicText: '公开的服装尺码信息' }));
    await tx.customer.update({ where: { id: f.customerId }, data: { status: 'TRADE_RESTRICTED' } });
    const scope = { scopeType: 'ORDER' as const, scopeId: f.orderId };
    expect((await f.communication.readPublicCommunication(tx, f.customer, scope)).total).toBe(1);
    await expect(f.communication.readPublicCommunication(tx, { ...f.customer, identity: f.otherCustomer.identity }, scope))
      .rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    await expect(f.communication.appendCommunication(tx, f.customer, input(f))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

it.each([
  { result: '' }, { result: '字'.repeat(4001) }, { nextStep: '字'.repeat(1001) }, { publicText: '字'.repeat(2001) },
  { correctionReason: '无对象' }, { correctsId: randomUUID() }, { channel: 'EMAIL' }, { occurredAt: new Date('invalid') },
  { occurredAt: new Date(Date.now() + 3600000) }, { authorEmployeeId: randomUUID() }, { attachments: '无效' }, { requestId: '错误编号' },
])('拒绝非法沟通字段，不将载荷回显到异常：%j', async changes => {
  await transaction(async (tx, f) => {
    await expect(f.communication.appendCommunication(tx, f.staff, { ...input(f), ...changes } as CommunicationInput))
      .rejects.toBeInstanceOf(RecordInputError);
    expect(await tx.communication.count({ where: { scopeId: f.orderId } })).toBe(0);
  });
});

it('文字长度边界与纯文本原样存储；内部空白公开说明规范化为NULL', async () => {
  await transaction(async (tx, f) => {
    const original = await f.communication.appendCommunication(tx, f.staff, input(f, {
      result: '字'.repeat(4000), nextStep: '字'.repeat(1000), publicText: '<script>仅作为纯文本</script>',
    }));
    const correction = await f.communication.appendCommunication(tx, f.staff, input(f, { correctsId: original.id,
      correctionReason: '字'.repeat(500), publicText: '字'.repeat(2000) }));
    expect(await tx.communication.findUniqueOrThrow({ where: { id: correction.id } })).toHaveProperty('correctionReason', '字'.repeat(500));
    const privateRow = await f.communication.appendCommunication(tx, f.staff, input(f, { publicText: '   ' }));
    expect(await tx.communication.findUniqueOrThrow({ where: { id: privateRow.id } })).toHaveProperty('publicText', null);
  });
});

it.each([{ page: 0 }, { page: 1.5 }, { pageSize: 101 }, { pageSize: 0 }, { page: Number.MAX_SAFE_INTEGER }, { sort: 'result' }])('拒绝非法分页：%j', async page => {
  await transaction(async (tx, f) => {
    await expect(f.communication.readPublicCommunication(tx, f.customer, { scopeType: 'ORDER', scopeId: f.orderId }, page))
      .rejects.toBeInstanceOf(RecordInputError);
  });
});

it.each(['EMPLOYEE', 'CUSTOMER', 'SYSTEM'] as const)('状态历史支持%s主体，真实领域变更与历史同事务', async type => {
  await transaction(async (tx, f) => {
    const actor: AuditActor = type === 'SYSTEM' ? { type } : { type, id: type === 'EMPLOYEE' ? f.employeeId : f.customerId };
    const command = transition(f); const history = await f.history.appendStateHistory(tx, actor, command);
    await tx.$executeRaw`UPDATE record_contract_fixture SET state='CONFIRMED' WHERE id=${f.orderId}::uuid AND kind='ORDER'`;
    expect(await tx.businessStateHistory.findUniqueOrThrow({ where: { id: history.id } })).toMatchObject({
      commandKey: command.commandKey, actorType: type, fromState: 'CREATED', toState: 'CONFIRMED',
      actorEmployeeId: type === 'EMPLOYEE' ? f.employeeId : null, actorCustomerId: type === 'CUSTOMER' ? f.customerId : null,
    });
    expect((await fact(tx, f.orderId, 'ORDER')).state).toBe('CONFIRMED');
  });
});

it('动作键唯一性覆盖聚合类型和状态维度；不同聚合类型可使用相同动作键', async () => {
  await transaction(async (tx, f) => {
    const command = transition(f);
    await f.history.appendStateHistory(tx, { type: 'SYSTEM' }, command);
    await f.history.appendStateHistory(tx, { type: 'SYSTEM' }, { ...command, aggregateType: 'FULFILLMENT' });
    expect(await tx.businessStateHistory.count({ where: { aggregateId: f.orderId } })).toBe(2);
  });
});

it('重复动作键不伪装为业务成功重放，唯一冲突导致外层命令整体回滚', async () => {
  const id = randomUUID();
  await expect(prisma.$transaction(async tx => {
    const f = await fixture(tx); const command = transition(f, { commandKey: id });
    await f.history.appendStateHistory(tx, { type: 'SYSTEM' }, command);
    await f.history.appendStateHistory(tx, { type: 'SYSTEM' }, command);
  })).rejects.toMatchObject({ code: 'P2002' });
  expect(await prisma.businessStateHistory.count({ where: { commandKey: id } })).toBe(0);
});

it.each([{ fromState: 'WRONG' }, { toState: 'UNSUPPORTED' }, { dimension: 'unknown' }, { aggregateId: randomUUID() }])('真实领域适配器拒绝非法状态迁移：%j', async changes => {
  await transaction(async (tx, f) => {
    await expect(f.history.appendStateHistory(tx, { type: 'SYSTEM' }, transition(f, changes))).rejects.toThrow();
    expect(await tx.businessStateHistory.count({ where: { aggregateId: f.orderId } })).toBe(0);
  });
});

it.each([{ commandKey: '' }, { commandKey: '字'.repeat(151) }, { requestId: 'wrong' }, { reason: '字'.repeat(501) },
  { publicText: '字'.repeat(2001) }, { dimension: '字'.repeat(51) }, { toState: '字'.repeat(81) }])('状态历史字段边界拒绝：%j', async changes => {
  await transaction(async (tx, f) => {
    await expect(f.history.appendStateHistory(tx, { type: 'SYSTEM' }, transition(f, changes))).rejects.toBeInstanceOf(RecordInputError);
  });
});

it('状态初始化可无fromState；拒绝SYSTEM伪造员工ID以及未知载荷', async () => {
  await transaction(async (tx, f) => {
    await f.history.appendStateHistory(tx, { type: 'SYSTEM' }, transition(f, { fromState: null, toState: 'CREATED' }));
    await expect(f.history.appendStateHistory(tx, { type: 'SYSTEM', id: f.employeeId } as AuditActor, transition(f))).rejects.toBeInstanceOf(RecordInputError);
    await expect(f.history.appendStateHistory(tx, { type: 'SYSTEM' }, { ...transition(f), password: 'secret' } as StateTransition))
      .rejects.toBeInstanceOf(RecordInputError);
  });
});

it('审计真实外键失败同时回滚沟通、状态历史、主体更改及测试业务变更', async () => {
  const commandKey = randomUUID(); const requestId = randomUUID(); let employeeId = ''; let businessId = '';
  class FailingAudit extends AuditService {
    override appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
      return super.appendAudit(tx, { ...payload, actor: { type: 'EMPLOYEE', id: randomUUID() } });
    }
  }
  await expect(prisma.$transaction(async tx => {
    const f = await fixture(tx); employeeId = f.employeeId; businessId = f.orderId;
    await f.history.appendStateHistory(tx, { type: 'SYSTEM' }, transition(f, { commandKey }));
    await tx.employee.update({ where: { id: f.employeeId }, data: { displayName: '应随审计失败回滚' } });
    await tx.$executeRaw`UPDATE record_contract_fixture SET state='CONFIRMED' WHERE id=${f.orderId}::uuid`;
    await new CommunicationService(identities, f.adapters, new FailingAudit()).appendCommunication(tx, f.staff, input(f, { requestId }));
  })).rejects.toMatchObject({ code: 'P2003' });
  expect(await prisma.communication.count({ where: { scopeId: businessId } })).toBe(0);
  expect(await prisma.businessStateHistory.count({ where: { commandKey } })).toBe(0);
  expect(await prisma.employee.findUnique({ where: { id: employeeId } })).toBeNull();
  expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
});

it('无真实适配器时写入及读取全部明确拒绝，不能生成虚假成功记录', async () => {
  await transaction(async (tx, f) => {
    const adapters = new BusinessRecordAdapters(); const service = new CommunicationService(identities, adapters, audit);
    const target = { scopeType: 'ORDER' as const, scopeId: f.orderId };
    await expect(service.appendCommunication(tx, f.staff, input(f))).rejects.toBeInstanceOf(BusinessModuleNotReadyError);
    await expect(service.readInternalCommunication(tx, f.staff, target)).rejects.toBeInstanceOf(BusinessModuleNotReadyError);
    await expect(service.readPublicCommunication(tx, f.customer, target)).rejects.toBeInstanceOf(BusinessModuleNotReadyError);
    await expect(new StateHistoryService(adapters).appendStateHistory(tx, { type: 'SYSTEM' }, transition(f)))
      .rejects.toBeInstanceOf(BusinessModuleNotReadyError);
    expect(await tx.communication.count({ where: { scopeId: f.orderId } })).toBe(0);
  });
});

it('生产RecordsModule依赖可组装且默认无适配器，不注册测试业务', async () => {
  const module = await Test.createTestingModule({ imports: [ConfigModule, RecordsModule] }).compile();
  try {
    const adapters = module.get(BusinessRecordAdapters);
    expect(() => adapters.communication('ORDER')).toThrow(BusinessModuleNotReadyError);
    expect(() => adapters.stateHistory('AFTER_SALE')).toThrow(BusinessModuleNotReadyError);
    expect(module.get(CommunicationService)).toBeInstanceOf(CommunicationService);
    expect(module.get(StateHistoryService)).toBeInstanceOf(StateHistoryService);
  } finally { await module.close(); }
});

it('拒绝重复适配器注册及根客户端误传', async () => {
  const adapters = configured();
  expect(() => adapters.registerCommunication(scopeAdapter('ORDER'))).toThrow(RecordInputError);
  expect(() => adapters.registerStateHistory(stateAdapter('ORDER'))).toThrow(RecordInputError);
  const service = new CommunicationService(identities, adapters, audit);
  const access = {} as CommunicationAccess; const target = { scopeType: 'ORDER' as const, scopeId: randomUUID() };
  await expect(service.appendCommunication(prisma, access, {} as CommunicationInput)).rejects.toThrow('公共记录必须使用调用方事务客户端');
  await expect(service.readPublicCommunication(prisma, access, target)).rejects.toThrow('公共记录必须使用调用方事务客户端');
  await expect(service.readInternalCommunication(prisma, access, target)).rejects.toThrow('公共记录必须使用调用方事务客户端');
  await expect(new StateHistoryService(adapters).appendStateHistory(prisma, { type: 'SYSTEM' }, {} as StateTransition))
    .rejects.toThrow('公共记录必须使用调用方事务客户端');
});
