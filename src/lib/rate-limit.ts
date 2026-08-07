/**
 * 限流器：优先使用 Supabase 持久化计数，失败时回退到内存 Map
 *
 * Supabase 模式可解决 Serverless 多实例 / 实例回收导致的内存限流被绕过问题。
 * 内存回退保证在迁移期或数据库异常时服务不中断，但防护强度降级。
 */

import { getSupabase } from "@/lib/supabase";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ─── 内存回退 ──────────────────────────────────────────────

const memoryStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 分钟
let lastCleanup = Date.now();

function memoryCleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt < now) {
      memoryStore.delete(key);
    }
  }
}

function memoryRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  memoryCleanup();

  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.resetAt < now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, resetAt: now + windowMs };
  }

  entry.count++;
  const remaining = Math.max(0, maxAttempts - entry.count);

  if (entry.count > maxAttempts) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining, resetAt: entry.resetAt };
}

// ─── Supabase 持久化限流 ───────────────────────────────────

async function supabaseRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number } | null> {
  try {
    const supabase = getSupabase();
    const now = new Date();
    const resetAt = new Date(now.getTime() + windowMs);

    // 先清理过期条目
    await supabase.from("rate_limits").delete().lt("reset_at", now.toISOString());

    // 尝试获取当前计数
    const { data: existing } = await supabase
      .from("rate_limits")
      .select("count, reset_at")
      .eq("key", key)
      .single();

    if (!existing || new Date(existing.reset_at) < now) {
      // 新窗口或已过期，upsert 新记录
      const { error } = await supabase
        .from("rate_limits")
        .upsert({
          key,
          count: 1,
          reset_at: resetAt.toISOString(),
          updated_at: now.toISOString(),
        });
      if (error) throw error;
      return { allowed: true, remaining: maxAttempts - 1, resetAt: resetAt.getTime() };
    }

    const newCount = existing.count + 1;
    const { error: updateError } = await supabase
      .from("rate_limits")
      .update({
        count: newCount,
        updated_at: now.toISOString(),
      })
      .eq("key", key);
    if (updateError) throw updateError;

    const resetAtMs = new Date(existing.reset_at).getTime();
    if (newCount > maxAttempts) {
      return { allowed: false, remaining: 0, resetAt: resetAtMs };
    }
    return { allowed: true, remaining: Math.max(0, maxAttempts - newCount), resetAt: resetAtMs };
  } catch (err) {
    console.error("[RateLimit] Supabase 限流失败，回退到内存:", err);
    return null;
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
export async function rateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const supabaseResult = await supabaseRateLimit(key, maxAttempts, windowMs);
  if (supabaseResult) return supabaseResult;
  return memoryRateLimit(key, maxAttempts, windowMs);
}

/** 获取客户端 IP（从 Vercel 头中提取） */
export function getClientIP(request: { headers: Headers }): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
