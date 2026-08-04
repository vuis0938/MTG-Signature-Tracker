/**
 * 弹窗数据预加载工具
 *
 * 原理：用户 hover 卡牌/画家名时，提前发起 API 请求并缓存 Promise。
 * 点击时直接取已缓存的 Promise（若已 resolve 则零延迟拿到数据）。
 */

// ─── 数据预加载缓存 ────────────────────────────────────────

const preloadCache = new Map<string, Promise<unknown>>();
const PRELOAD_TTL_MS = 30_000; // 30 秒后过期，避免使用过旧数据

/**
 * 预加载数据（hover 时调用）
 * 同一 URL 多次调用只发一次请求，结果缓存 30 秒
 */
export function preloadData<T>(url: string): Promise<T> {
  const cached = preloadCache.get(url);
  if (cached) return cached as Promise<T>;

  const promise = fetch(url)
    .then((res) => res.json())
    .finally(() => {
      // TTL 过期后清理，下次 hover 重新拉取
      setTimeout(() => preloadCache.delete(url), PRELOAD_TTL_MS);
    });

  preloadCache.set(url, promise);
  return promise as Promise<T>;
}

/**
 * 取预加载数据（点击时调用）
 * 有缓存则用缓存（可能已 resolve，零延迟），无缓存则现场 fetch
 */
export function getPreloadedData<T>(url: string): Promise<T> {
  const cached = preloadCache.get(url);
  if (cached) return cached as Promise<T>;
  return fetch(url).then((res) => res.json()) as Promise<T>;
}

// ─── 弹窗 chunk 预加载（已弃用，弹窗组件改为直接导入）──

let chunksPreloaded = false;

/**
 * 保留接口兼容性，弹窗组件已改为直接导入，无需预加载 chunk
 */
export function preloadDialogChunks() {
  if (chunksPreloaded || typeof window === "undefined") return;
  chunksPreloaded = true;
}
