/**
 * 认证工具模块
 *
 * - 密码哈希：PBKDF2-SHA256（Node.js 内置 crypto，无需额外依赖）
 * - Token 签名：HMAC-SHA256（无状态，无需 sessions 表）
 */

import "server-only";
import { createHmac, randomBytes, pbkdf2Sync, timingSafeEqual } from "crypto";

// OWASP 2023 建议 PBKDF2-SHA256 ≥ 600,000 次
const ITERATIONS = 600_000;
const LEGACY_ITERATIONS = 100_000; // 旧哈希兼容
const KEY_LENGTH = 64;

// 生产环境必须设置 TOKEN_SECRET，否则运行时报错
// 开发环境使用默认值方便本地调试
// 使用懒加载避免 Next.js 构建时（无环境变量）模块求值失败
let _tokenSecret: string | null = null;
function getTokenSecret(): string {
  if (_tokenSecret !== null) return _tokenSecret;
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "生产环境必须设置 TOKEN_SECRET 环境变量（建议 32+ 字符随机字符串）"
      );
    }
    _tokenSecret = "mtg-dev-secret-change-in-production";
  } else {
    _tokenSecret = secret;
  }
  return _tokenSecret;
}

// ─── 密码哈希 ──────────────────────────────────────────────

/**
 * 哈希密码（返回 "iterations:salt:hash" 格式的字符串）
 * 迭代次数写入哈希，便于未来调整参数时兼容旧哈希
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256").toString("hex");
  return `${ITERATIONS}:${salt}:${hash}`;
}

/**
 * 验证密码是否匹配哈希
 * 兼容两种格式：
 *   - 新格式 "iterations:salt:hash"
 *   - 旧格式 "salt:hash"（迭代次数默认 100,000）
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  let iterations: number;
  let salt: string | undefined;
  let expectedHash: string | undefined;

  if (parts.length === 3) {
    // 新格式：iterations:salt:hash
    iterations = parseInt(parts[0], 10);
    salt = parts[1];
    expectedHash = parts[2];
    if (isNaN(iterations) || iterations < 1) return false;
  } else if (parts.length === 2) {
    // 旧格式：salt:hash（迭代次数 100,000）
    iterations = LEGACY_ITERATIONS;
    salt = parts[0];
    expectedHash = parts[1];
  } else {
    return false;
  }

  if (!salt || !expectedHash) return false;
  const hash = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, "sha256").toString("hex");
  // 使用 timingSafeEqual 防止时序攻击
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
  } catch {
    return false;
  }
}

/**
 * 检查哈希是否需要升级（旧格式或低迭代次数）
 */
export function needsHashUpgrade(stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length === 3) {
    const iterations = parseInt(parts[0], 10);
    return !isNaN(iterations) && iterations < ITERATIONS;
  }
  return true; // 旧格式（2 段）需要升级
}

// ─── Token 签名 ────────────────────────────────────────────

// Token 有效期：7 天
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface TokenPayload {
  u: string; // username
  e: number; // expiry timestamp (ms)
}

/**
 * 生成签名 token（HMAC-SHA256）
 * 格式：base64(JSON{u,e}).base64(hmac)
 * 无状态：无需 DB 存储，proxy 可直接验证签名
 */
export function createToken(username: string): string {
  const payload: TokenPayload = {
    u: username,
    e: Date.now() + TOKEN_TTL_MS,
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getTokenSecret())
    .update(payloadStr)
    .digest("base64url");
  return `${payloadStr}.${signature}`;
}

/**
 * 验证 token 并返回 username（无效或过期则返回 null）
 * 可在 proxy 和 API 路由中使用
 */
export function verifyToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;
  const expectedSignature = createHmac("sha256", getTokenSecret())
    .update(payloadStr)
    .digest("base64url");

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadStr, "base64url").toString("utf-8")) as TokenPayload;
    // 检查过期时间
    if (typeof payload.e !== "number" || Date.now() > payload.e) {
      return null;
    }
    return payload.u;
  } catch {
    return null;
  }
}

// ─── 请求辅助 ──────────────────────────────────────────────

/** 从 NextRequest 的 cookie 中提取已验证的用户名 */
export function getUserFromRequest(request: { cookies: { get: (name: string) => { value: string } | undefined } }): string | null {
  const token = request.cookies.get("auth_token")?.value;
  return verifyToken(token);
}

// ─── 管理员权限 ────────────────────────────────────────────

/**
 * 检查用户是否为管理员
 * 通过环境变量 ADMIN_USERS 配置（逗号分隔的用户名列表）
 */
export function isAdmin(userName: string): boolean {
  const adminUsers = process.env.ADMIN_USERS;
  if (!adminUsers) return false;
  const admins = adminUsers.split(",").map((u) => u.trim().toLowerCase());
  return admins.includes(userName.trim().toLowerCase());
}
