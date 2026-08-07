/**
 * 边缘运行时兼容的 Supabase 客户端
 *
 * Next.js Middleware 在 Edge Runtime 中执行，无法使用 Node.js 内置模块。
 * @supabase/supabase-js 本身是 isomorphic 的，但 src/lib/supabase.ts 标有
 * server-only 并在服务端 Node.js 环境中做了额外处理（超时、降级策略）。
 * 本模块提供一个精简版客户端，专门用于 Edge Runtime 查询。
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createTimeoutSignal, combineSignals } from "@/lib/timeout-signal";

const SUPABASE_TIMEOUT_MS = 15000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const { signal: timeoutSignal, clear: clearTimeoutSignal } = createTimeoutSignal(SUPABASE_TIMEOUT_MS);
  const { signal, clear: clearCombined } = init?.signal
    ? combineSignals([init.signal, timeoutSignal])
    : { signal: timeoutSignal, clear: clearTimeoutSignal };

  return fetch(input, { ...init, signal }).finally(() => {
    clearCombined();
    clearTimeoutSignal();
  });
};

let _edgeClient: SupabaseClient | null = null;

export function getSupabaseEdge(): SupabaseClient {
  if (!_edgeClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for edge runtime"
      );
    }

    _edgeClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: fetchWithTimeout,
      },
    });
  }
  return _edgeClient;
}
