import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── 服务端专用 Client（使用 Service Role Key，绕过 RLS）─────
// 所有 API 路由应使用此 Client，享有完整数据库权限。
// Service Role Key 仅存在服务端环境变量，绝不暴露给前端。
let _serviceClient: SupabaseClient | null = null;

/**
 * 单次数据库请求超时（15s）
 *
 * 默认 fetch 无超时，Supabase 网络抖动时请求会无限挂起，
 * 拖垮整个 API 路由的响应。超时后请求中止，路由快速返回错误。
 */
const SUPABASE_TIMEOUT_MS = 15000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_TIMEOUT_MS);
  const signal =
    init?.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
  return fetch(input, { ...init, signal });
};

export function getSupabase(): SupabaseClient {
  if (!_serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
    }

    // 优先使用 Service Role Key（绕过 RLS，服务端全权限）
    // 如果未配置 Service Role Key，降级使用 anon key（RLS 会限制访问）
    const key = serviceKey || anonKey;
    if (!key) {
      throw new Error(
        "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
      );
    }

    if (serviceKey && !anonKey) {
      console.warn(
        "[Supabase] 仅配置了 SERVICE_ROLE_KEY，建议同时配置 ANON_KEY 供前端使用"
      );
    }

    if (!serviceKey && process.env.NODE_ENV === "production") {
      console.warn(
        "[Supabase] 未配置 SUPABASE_SERVICE_ROLE_KEY，降级使用 anon key。建议配置 Service Role Key 以获得完整服务端权限。"
      );
    }

    _serviceClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: fetchWithTimeout,
      },
    });
  }
  return _serviceClient;
}

// 向后兼容：保留 supabase 导出，但改为懒加载
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return Reflect.get(getSupabase(), prop);
  },
});
