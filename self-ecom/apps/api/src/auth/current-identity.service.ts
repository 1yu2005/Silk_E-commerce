// 作用：结合 JWT、会话与主体的当前数据库快照确认身份和最新有效权限。
import { Prisma, type CustomerStatus, type EmployeeRole, type EmployeeStatus, type SubjectType } from '@prisma/client';
import { PermissionService } from '../permissions/permission.service.js';
import { JwtTokenService, TokenValidationError } from './jwt-token.service.js';
import { authNow, SessionAuthenticationError } from './session-support.js';

interface SessionFact {
  subjectType: SubjectType;
  employeeId: string | null;
  customerId: string | null;
  tokenVersion: number;
  expiresAt: Date;
  revokedAt: Date | null;
  accountId: string | null;
  accountTokenVersion: number | null;
  status: EmployeeStatus | CustomerStatus | null;
  role: EmployeeRole | null;
  mustChangePassword: boolean | null;
  permissionVersion: number | null;
  extraPermissions: string[];
  username: string | null;
  displayName: string | null;
}
interface BaseIdentity { subjectId: string; sessionId: string; tokenVersion: number }
export type CurrentIdentity =
  | (BaseIdentity & { subjectType: 'EMPLOYEE'; role: EmployeeRole; mustChangePassword: boolean;
    username: string; displayName: string; status: 'ACTIVE';
    permissionVersion: number; extraPermissions: string[]; effectivePermissions: string[] })
  | (BaseIdentity & { subjectType: 'CUSTOMER'; status: CustomerStatus });

export class CurrentIdentityService {
  constructor(private readonly tokens: JwtTokenService, private readonly permissions: PermissionService,
    private readonly clock: () => Date = () => new Date()) {}

  /** Guard可传根客户端；敏感命令锁定主体后须再次传自身tx校验，不能复用先前结果作为授权。 */
  async authenticate(db: Pick<Prisma.TransactionClient, '$queryRaw'>, token: string,
    expectedSubject: SubjectType): Promise<CurrentIdentity> {
    const claims = await this.tokens.verify(token, expectedSubject);
    // 一条语句取得会话、账号和额外权限，使用同一数据库快照；不查询密码、手机号或缓存身份。
    const account = expectedSubject === 'EMPLOYEE'
      ? Prisma.sql`e.id AS "accountId", e.token_version AS "accountTokenVersion", e.status, e.role, e.username, e.display_name AS "displayName",
          e.must_change_password AS "mustChangePassword", e.permission_version AS "permissionVersion",
          ARRAY(SELECT p.permission_code FROM employee_extra_permission p
            WHERE p.employee_id=e.id ORDER BY p.permission_code) AS "extraPermissions"`
      : Prisma.sql`c.id AS "accountId", c.token_version AS "accountTokenVersion", c.status,
          NULL::text AS role, NULL::text AS username, NULL::text AS "displayName", NULL::boolean AS "mustChangePassword", NULL::integer AS "permissionVersion",
          ARRAY[]::text[] AS "extraPermissions"`;
    const join = expectedSubject === 'EMPLOYEE'
      ? Prisma.sql`LEFT JOIN employee e ON e.id=s.employee_id`
      : Prisma.sql`LEFT JOIN customer c ON c.id=s.customer_id`;
    const [row] = await db.$queryRaw<SessionFact[]>(Prisma.sql`
      SELECT s.subject_type AS "subjectType", s.employee_id AS "employeeId", s.customer_id AS "customerId",
        s.token_version AS "tokenVersion", s.expires_at AS "expiresAt", s.revoked_at AS "revokedAt", ${account}
      FROM auth_session s ${join} WHERE s.id=${claims.sid}::uuid`);
    if (!row) throw new TokenValidationError('TOKEN_INVALID');
    if (row.subjectType !== expectedSubject) throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    const subjectId = claims.sub.toLowerCase();
    if ((expectedSubject === 'EMPLOYEE' ? row.employeeId : row.customerId) !== subjectId) {
      throw new TokenValidationError('TOKEN_INVALID');
    }
    if (row.revokedAt !== null) throw new SessionAuthenticationError('SESSION_REVOKED');
    const now = authNow(this.clock).getTime();
    if (now >= row.expiresAt.getTime() || now >= claims.exp * 1000) throw new TokenValidationError('TOKEN_EXPIRED');
    if (row.expiresAt.getTime() !== claims.exp * 1000) throw new TokenValidationError('TOKEN_INVALID');
    if (row.accountId !== subjectId || row.status === null || row.status === 'DISABLED' || row.status === 'LOGIN_FROZEN') {
      throw new SessionAuthenticationError('ACCOUNT_UNAVAILABLE');
    }
    if (row.tokenVersion !== claims.tokenVersion || row.accountTokenVersion !== claims.tokenVersion) {
      throw new TokenValidationError('TOKEN_INVALID');
    }
    const base = { subjectId, sessionId: claims.sid.toLowerCase(), tokenVersion: claims.tokenVersion };
    if (expectedSubject === 'EMPLOYEE') {
      if (row.role === null || row.mustChangePassword === null || row.permissionVersion === null
        || row.username === null || row.displayName === null || row.status !== 'ACTIVE') {
        throw new SessionAuthenticationError('ACCOUNT_UNAVAILABLE');
      }
      return { ...base, subjectType: 'EMPLOYEE', role: row.role, mustChangePassword: row.mustChangePassword,
        username: row.username, displayName: row.displayName, status: 'ACTIVE',
        permissionVersion: row.permissionVersion, extraPermissions: row.extraPermissions,
        effectivePermissions: this.permissions.effectivePermissions(row.role, row.extraPermissions) };
    }
    if (row.status !== 'NORMAL' && row.status !== 'TRADE_RESTRICTED') throw new SessionAuthenticationError('ACCOUNT_UNAVAILABLE');
    return { ...base, subjectType: 'CUSTOMER', status: row.status };
  }
}
