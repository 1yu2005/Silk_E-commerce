// 作用：严格签发和验证仅含最小身份与会话声明的员工或顾客 JWT。
import { errors, jwtVerify, SignJWT } from 'jose';
import type { SubjectType } from '@prisma/client';
import { validateJwtConfiguration, type JwtConfiguration } from '../config/jwt-configuration.js';

export type TokenErrorCode = 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_SUBJECT_MISMATCH';
export class TokenValidationError extends Error {
  constructor(public readonly code: TokenErrorCode) {
    super(code === 'TOKEN_EXPIRED' ? '登录凭证已过期' : code === 'TOKEN_SUBJECT_MISMATCH' ? '登录凭证所属登录域不匹配' : '登录凭证无效');
    this.name = 'TokenValidationError';
  }
}

export interface TokenIdentity {
  subjectId: string;
  sessionId: string;
  subjectType: SubjectType;
  tokenVersion: number;
}
export interface TokenClaims {
  sub: string;
  sid: string;
  subjectType: SubjectType;
  tokenVersion: number;
  iat: number;
  exp: number;
  iss: 'shop-api';
  aud: 'shop-admin' | 'shop-store';
}

const audiences = { EMPLOYEE: 'shop-admin', CUSTOMER: 'shop-store' } as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const claimNames = ['sub', 'sid', 'subjectType', 'tokenVersion', 'iat', 'exp', 'iss', 'aud'];
const safeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const subjectType = (value: unknown): value is SubjectType => value === 'EMPLOYEE' || value === 'CUSTOMER';

export class JwtTokenService {
  #key: Uint8Array;
  #ttlSeconds: number;
  #clock: () => Date;

  constructor(config: JwtConfiguration, clock: () => Date = () => new Date()) {
    const checked = validateJwtConfiguration({ JWT_SECRET: config.secret, JWT_TTL_SECONDS: String(config.ttlSeconds) });
    // 密钥不保存为可枚举的实例属性，避免误序列化服务实例泄漏配置。
    this.#key = new TextEncoder().encode(checked.secret);
    this.#ttlSeconds = checked.ttlSeconds;
    this.#clock = clock;
  }

  async issue(identity: TokenIdentity) {
    if (!subjectType(identity.subjectType) || !uuid.test(identity.subjectId)
      || !uuid.test(identity.sessionId) || !safeInteger(identity.tokenVersion)) {
      throw new Error('JWT签发身份不合法');
    }
    const issuedAtSeconds = Math.floor(this.#clock().getTime() / 1000);
    if (!safeInteger(issuedAtSeconds)) throw new Error('JWT签发时钟不合法');
    const expiresAtSeconds = issuedAtSeconds + this.#ttlSeconds;
    const issuedAt = new Date(issuedAtSeconds * 1000);
    const expiresAt = new Date(expiresAtSeconds * 1000);
    if (!Number.isFinite(expiresAt.getTime())) throw new Error('JWT签发时钟不合法');
    // 显式构造载荷，不展开调用方对象，防止手机号、权限或密码进入token。
    const accessToken = await new SignJWT({ sid: identity.sessionId, subjectType: identity.subjectType,
      tokenVersion: identity.tokenVersion })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(identity.subjectId).setIssuer('shop-api').setAudience(audiences[identity.subjectType])
      .setIssuedAt(issuedAtSeconds).setExpirationTime(expiresAtSeconds).sign(this.#key);
    // 返回整秒时间，后续会话必须原样保存expiresAt，与JWT exp完全一致。
    return { accessToken, issuedAt, expiresAt };
  }

  /** 这里只验证JWT事实；每请求还必须查会话、账号状态及最新权限。 */
  async verify(token: string, expectedSubject: SubjectType): Promise<TokenClaims> {
    if (!subjectType(expectedSubject) || typeof token !== 'string' || !token || token.length > 4096) {
      throw new TokenValidationError('TOKEN_INVALID');
    }
    const now = this.#clock();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!safeInteger(nowSeconds)) throw new Error('JWT校验时钟不合法');
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.#key, {
        algorithms: ['HS256'], issuer: 'shop-api', audience: ['shop-admin', 'shop-store'],
        requiredClaims: claimNames, typ: 'JWT', currentDate: now, clockTolerance: 0,
      });
      if (Object.keys(protectedHeader).some(key => !['alg', 'typ'].includes(key)) || protectedHeader.typ !== 'JWT'
        || Object.keys(payload).some(key => !claimNames.includes(key))
        || typeof payload.sub !== 'string' || !uuid.test(payload.sub)
        || typeof payload.sid !== 'string' || !uuid.test(payload.sid)
        || !subjectType(payload.subjectType) || payload.aud !== audiences[payload.subjectType]
        || !safeInteger(payload.tokenVersion) || !safeInteger(payload.iat) || !safeInteger(payload.exp)
        || payload.iat > nowSeconds || payload.exp <= payload.iat) {
        throw new TokenValidationError('TOKEN_INVALID');
      }
      if (payload.subjectType !== expectedSubject) throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
      return { sub: payload.sub, sid: payload.sid, subjectType: payload.subjectType,
        tokenVersion: payload.tokenVersion, iat: payload.iat, exp: payload.exp, iss: 'shop-api', aud: payload.aud };
    } catch (error: unknown) {
      if (error instanceof TokenValidationError) throw error;
      // jose异常可能附带payload；只转换为固定错误，不保留原异常或cause。
      throw new TokenValidationError(error instanceof errors.JWTExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
    }
  }
}
