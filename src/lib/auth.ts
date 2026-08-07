/**
 * 认证工具模块
 *
 * - 密码哈希：PBKDF2-SHA256（Node.js 内置 crypto，无需额外依赖）
 * - Token 签名：HMAC-SHA256（无状态，无需 sessions 表）
 * - Token 撤销：通过 token_version 字段实现，修改密码 / 登出 / 管理员重置密码时
 *   更新 users.token_version，使此前签发的 token 失效
 * - 安全问题答案哈希：SHA-256 + salt（答案空间小，用 PBKDF2 也挡不住暴力枚举）
 */

import "server-only";
import { createHmac, randomBytes, pbkdf2, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { getSupabase } from "@/lib/supabase";

// 异步 PBKDF2：600k 次迭代约阻塞事件循环 ~200ms，
// 同步版本会让并发请求全部排队等待，异步版本释放事件循环
const pbkdf2Async = promisify(pbkdf2);

// OWASP 2023 建议 PBKDF2-SHA256 ≥ 600,000 次
const ITERATIONS = 600_000;
const LEGACY_ITERATIONS = 100_000; // 旧哈希兼容
const KEY_LENGTH = 64;

// 任何环境都必须设置 TOKEN_SECRET，否则运行时报错
// 使用懒加载避免 Next.js 构建时（无环境变量）模块求值失败
let _tokenSecret: string | null = null;
function getTokenSecret(): string {
  if (_tokenSecret !== null) return _tokenSecret;
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "必须设置 TOKEN_SECRET 环境变量（建议 32+ 字符随机字符串）"
    );
  }
  _tokenSecret = secret;
  return _tokenSecret;
}

// ─── 密码哈希 ──────────────────────────────────────────────

/**
 * 哈希密码（返回 "iterations:salt:hash" 格式的字符串）
 * 迭代次数写入哈希，便于未来调整参数时兼容旧哈希
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await pbkdf2Async(password, salt, ITERATIONS, KEY_LENGTH, "sha256")).toString("hex");
  return `${ITERATIONS}:${salt}:${hash}`;
}

/**
 * 验证密码是否匹配哈希
 * 兼容两种格式：
 *   - 新格式 "iterations:salt:hash"
 *   - 旧格式 "salt:hash"（迭代次数默认 100,000）
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
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
  const hash = (await pbkdf2Async(password, salt, iterations, KEY_LENGTH, "sha256")).toString("hex");
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
  v: string; // token_version（用于撤销）
}

/**
 * 生成或读取用户的 token_version
 * - 用户不存在：返回 null（登录失败流程中不应签发 token）
 * - 用户存在但 token_version 为空：生成一个随机值并写入数据库
 */
async function getOrCreateTokenVersion(username: string): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const trimmed = username.trim();

    const { data: user } = await supabase
      .from("users")
      .select("token_version")
      .eq("username", trimmed)
      .single();

    if (!user) return null;

    if (user.token_version) {
      return user.token_version as string;
    }

    const newVersion = randomBytes(16).toString("hex");
    const { error } = await supabase
      .from("users")
      .update({ token_version: newVersion })
      .eq("username", trimmed);

    if (error) {
      console.error("[getOrCreateTokenVersion] 更新失败:", error);
      return null;
    }
    return newVersion;
  } catch (err) {
    console.error("[getOrCreateTokenVersion] 异常:", err);
    return null;
  }
}

/**
 * 验证 token_version 是否与数据库一致
 */
async function verifyTokenVersion(
  username: string,
  tokenVersion: string
): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase
      .from("users")
      .select("token_version")
      .eq("username", username.trim())
      .single();

    if (!user || !user.token_version) return false;
    return user.token_version === tokenVersion;
  } catch (err) {
    console.error("[verifyTokenVersion] 异常:", err);
    return false;
  }
}

/**
 * 生成签名 token（HMAC-SHA256）
 * 格式：base64(JSON{u,e,v}).base64(hmac)
 * 包含 token_version，可用于撤销已签发 token
 */
export async function createToken(username: string): Promise<string | null> {
  const tokenVersion = await getOrCreateTokenVersion(username);
  if (!tokenVersion) return null;

  const payload: TokenPayload = {
    u: username,
    e: Date.now() + TOKEN_TTL_MS,
    v: tokenVersion,
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getTokenSecret())
    .update(payloadStr)
    .digest("base64url");
  return `${payloadStr}.${signature}`;
}

/**
 * 验证 token 并返回 username（无效、过期或 token_version 不匹配则返回 null）
 * 可在 proxy 和 API 路由中使用
 */
export async function verifyToken(
  token: string | undefined | null
): Promise<string | null> {
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
    const payload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString("utf-8")
    ) as TokenPayload;
    // 检查过期时间
    if (typeof payload.e !== "number" || Date.now() > payload.e) {
      return null;
    }
    // 检查 token_version（撤销机制）
    if (!payload.v || !(await verifyTokenVersion(payload.u, payload.v))) {
      return null;
    }
    return payload.u;
  } catch {
    return null;
  }
}

/**
 * 撤销用户的所有现有 token
 * 用于：修改密码、忘记密码重置、登出、管理员重置密码
 */
export async function revokeTokens(username: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const newVersion = randomBytes(16).toString("hex");
    const { error } = await supabase
      .from("users")
      .update({ token_version: newVersion })
      .eq("username", username.trim());

    if (error) {
      console.error("[revokeTokens] 更新失败:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[revokeTokens] 异常:", err);
    return false;
  }
}

// ─── 请求辅助 ──────────────────────────────────────────────

/** 从 NextRequest 的 cookie 中提取已验证的用户名 */
export async function getUserFromRequest(request: {
  cookies: { get: (name: string) => { value: string } | undefined };
}): Promise<string | null> {
  const token = request.cookies.get("auth_token")?.value;
  return verifyToken(token);
}

// ─── 管理员权限 ────────────────────────────────────────────

/**
 * 检查用户是否为管理员
 * 通过环境变量 ADMIN_USERS 配置（逗号分隔的用户名列表）
 * 模块级缓存解析结果（Set.has O(1)），避免每次调用重复 split
 */
let _adminSet: Set<string> | null | undefined;

export function isAdmin(userName: string): boolean {
  // 测试环境 env 会被动态 stub，跳过缓存
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    const adminUsers = process.env.ADMIN_USERS;
    if (!adminUsers) return false;
    return adminUsers
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .includes(userName.trim().toLowerCase());
  }

  if (_adminSet === undefined) {
    const adminUsers = process.env.ADMIN_USERS;
    _adminSet = adminUsers
      ? new Set(adminUsers.split(",").map((u) => u.trim().toLowerCase()))
      : null;
  }
  return _adminSet !== null && _adminSet.has(userName.trim().toLowerCase());
}

// ─── 安全问题 ──────────────────────────────────────────────

/** 可选的安全问题列表（从共享文件导入，客户端可复用） */
export { SECURITY_QUESTIONS } from "@/lib/security-questions";

// 安全问题答案用 PBKDF2，迭代次数低于密码（答案验证频率低且答案空间小）
const SECURITY_ANSWER_ITERATIONS = 100_000;

/**
 * 哈希安全问题答案
 *
 * 答案先做规范化（trim + 转小写），再用 PBKDF2-SHA256 慢哈希。
 * 新格式："iterations:salt:hash"
 *
 * 安全说明：安全问题答案空间远小于密码，PBKDF2 可显著提升暴力枚举成本。
 * 配合 API 层的速率限制（每 IP 每小时 5 次）进一步防止枚举。
 */
export async function hashSecurityAnswer(answer: string): Promise<string> {
  const normalized = answer.trim().toLowerCase();
  const salt = randomBytes(16).toString("hex");
  const hash = (await pbkdf2Async(normalized, salt, SECURITY_ANSWER_ITERATIONS, KEY_LENGTH, "sha256")).toString("hex");
  return `${SECURITY_ANSWER_ITERATIONS}:${salt}:${hash}`;
}

/**
 * 验证安全问题答案
 *
 * 兼容两种格式：
 *   - 新格式 "iterations:salt:hash"（PBKDF2-SHA256）
 *   - 旧格式 "salt:hash"（SHA-256，保留用于平滑迁移）
 */
export async function verifySecurityAnswer(answer: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length === 3) {
    // 新格式
    const iterations = parseInt(parts[0], 10);
    const salt = parts[1];
    const expectedHash = parts[2];
    if (isNaN(iterations) || iterations < 1 || !salt || !expectedHash) return false;

    const normalized = answer.trim().toLowerCase();
    const hash = (await pbkdf2Async(normalized, salt, iterations, KEY_LENGTH, "sha256")).toString("hex");
    try {
      return timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
    } catch {
      return false;
    }
  }

  if (parts.length === 2) {
    // 旧格式（SHA-256）：兼容已有数据，验证成功后建议升级
    const [salt, expectedHash] = parts;
    if (!salt || !expectedHash) return false;

    const normalized = answer.trim().toLowerCase();
    const hash = createHash("sha256").update(salt + normalized).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * 检查安全问题答案哈希是否需要升级（旧格式或低迭代次数）
 */
export function needsSecurityAnswerUpgrade(stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length === 3) {
    const iterations = parseInt(parts[0], 10);
    return !isNaN(iterations) && iterations < SECURITY_ANSWER_ITERATIONS;
  }
  return true;
}
