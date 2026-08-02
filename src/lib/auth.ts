/**
 * 认证工具模块
 *
 * - 密码哈希：PBKDF2-SHA256（Node.js 内置 crypto，无需额外依赖）
 * - Token 签名：HMAC-SHA256（无状态，无需 sessions 表）
 */

import { createHmac, randomBytes, pbkdf2Sync, timingSafeEqual } from "crypto";

const ITERATIONS = 100_000;
const KEY_LENGTH = 64;

// 生产环境必须设置 TOKEN_SECRET，否则启动时报错
// 开发环境使用默认值方便本地调试
const TOKEN_SECRET = (() => {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "生产环境必须设置 TOKEN_SECRET 环境变量（建议 32+ 字符随机字符串）"
      );
    }
    return "mtg-dev-secret-change-in-production";
  }
  return secret;
})();

// ─── 密码哈希 ──────────────────────────────────────────────

/** 哈希密码（返回 "salt:hash" 格式的字符串） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

/** 验证密码是否匹配哈希 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHash] = stored.split(":");
  if (!salt || !expectedHash) return false;
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256").toString("hex");
  // 使用 timingSafeEqual 防止时序攻击
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
  } catch {
    return false;
  }
}

// ─── Token 签名 ────────────────────────────────────────────

/**
 * 生成签名 token（HMAC-SHA256）
 * 格式：base64(username).base64(hmac)
 * 无状态：无需 DB 存储，proxy 可直接验证签名
 */
export function createToken(username: string): string {
  const payload = Buffer.from(username).toString("base64url");
  const signature = createHmac("sha256", TOKEN_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * 验证 token 并返回 username（无效则返回 null）
 * 可在 proxy 和 API 路由中使用
 */
export function verifyToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expectedSignature = createHmac("sha256", TOKEN_SECRET)
    .update(payload)
    .digest("base64url");

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    return Buffer.from(payload, "base64url").toString("utf-8");
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
