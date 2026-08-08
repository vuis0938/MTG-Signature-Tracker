"use client";

import { useEffect } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import type { ReactNode } from "react";

/**
 * SWR 全局缓存注入器
 *
 * 做两件事：
 * 1. 通过 SWRConfig.fallback 提供渲染数据（兜底，与 fallbackData 互补）
 * 2. 通过 mutate 将数据写入 SWR 全局缓存（核心价值）
 *
 * 为什么需要 mutate？
 * SWRConfig.fallback 只提供渲染时的 data 值，不写入全局 Map 缓存。
 * 这导致全局 mutate(key, updater) 的 current 为 undefined，
 * mutateCards 等跨页面乐观更新静默失败。
 *
 * 通过 useEffect 中调用 mutate(key, value, false) 写入全局缓存，
 * 后续所有 mutate 调用都能读取到完整数据，跨页面同步真正生效。
 *
 * 注意：fallbackData 仍是主渲染路径（hook 级，100% 可靠），
 * 本组件提供的能力是附加的全局缓存填充，不依赖 context 合并时序。
 */
function CachePopulator({ fallback }: { fallback: Record<string, unknown> }) {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    for (const [key, value] of Object.entries(fallback)) {
      // revalidate: false — 不触发请求，只写入缓存
      mutate(key, value, false);
    }
  }, [fallback, mutate]);

  return null;
}

export function SWRFallbackProvider({
  fallback,
  children,
}: {
  fallback: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <SWRConfig
      value={{
        fallback,
        // 全局默认：关闭 focus/reconnect 自动刷新
        // revalidateOnMount 由各 hook 自身的 config 控制
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }}
    >
      <CachePopulator fallback={fallback} />
      {children}
    </SWRConfig>
  );
}