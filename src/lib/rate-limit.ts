/**
 * 轻量级内存限流器（适合单实例 Serverless 部署）
 *
 * 用于防止暴力破解登录、API 滥用等。
 * 注意：Vercel Serverless 函数实例可能被回收，此限流为尽力而为，
 * 但对个人小站已足够。如需精确限流可后续迁移到 Upstash Redis。
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// 定期清理过期条目，防止内存泄漏
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 分钟
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}

/**
 * 检查是否超过速率限制
 *
 * @param key 限流键（如 IP 地址 + 操作类型）
 * @param maxAttempts 最大尝试次数
 * @param windowMs 时间窗口（毫秒）
 * @returns { allowed: boolean; remaining: number; resetAt: number }
 */
export function rateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // 新窗口
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, resetAt: now + windowMs };
  }

  entry.count++;
  const remaining = Math.max(0, maxAttempts - entry.count);

  if (entry.count > maxAttempts) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining, resetAt: entry.resetAt };
}

/** 获取客户端 IP（从 Vercel 头中提取） */
export function getClientIP(request: { headers: Headers }): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
