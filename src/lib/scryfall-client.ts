/**
 * 共享 Scryfall API 客户端
 *
 * 统一所有 API 路由的 Scryfall 调用，消除重复代码。
 * 包含：限速延迟、重试逻辑、分页查询、卡牌查询。
 */

import { Printing } from "@/types";
import type { ScryfallCard } from "@/lib/scryfall";

// ─── 常量 ──────────────────────────────────────────────────

export const SCRYFALL_UA = "MTG-Signature-Tracker/1.0";
const BASE_URL = "https://api.scryfall.com";
const MIN_DELAY_MS = 100;
const MAX_RETRIES = 2; // 初始 + 2 次重试 = 3 次机会
const FETCH_TIMEOUT_MS = 15_000; // 单次请求超时 15 秒

/** 随机抖动，避免惊群效应（多个请求同时重试） */
function jitter(baseMs: number): number {
  return baseMs + Math.random() * baseMs * 0.5;
}

// ─── 平滑限速器 ──────────────────────────────────────────

/**
 * 平滑限速器（队列模式，无突发）
 *
 * 每个调用者按顺序获得令牌，精确间隔 1/rate 秒。
 * 支持暂停：当收到 429 时，调用 pause() 阻止所有后续令牌发放，
 * 等待 Retry-After 时长后自动恢复，防止雪崩式 429。
 */
export class RateLimiter {
  private queue: Array<() => void> = [];
  private processing = false;
  private readonly intervalMs: number;
  private lastTokenTime: number;

  /** 暂停状态：非零表示暂停中，值为暂停结束时间戳 */
  private pauseUntil = 0;

  constructor(requestsPerSecond: number) {
    this.intervalMs = 1000 / requestsPerSecond;
    this.lastTokenTime = 0;
  }

  /** 获取一个令牌，若不足则排队等待 */
  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      if (!this.processing) this._process();
    });
  }

  /**
   * 暂停令牌发放指定毫秒数
   * 用于收到 429 时等待 Retry-After 时长，避免所有后续请求都触发限流
   */
  pause(ms: number): void {
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + ms);
  }

  private async _process(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      // 暂停检查：收到 429 后等待 Retry-After
      if (this.pauseUntil > 0) {
        const waitMs = this.pauseUntil - Date.now();
        if (waitMs > 0) {
          await delay(waitMs);
        }
        this.pauseUntil = 0;
        // 暂停后重置计时，避免立即发放令牌
        this.lastTokenTime = Date.now();
      }

      const now = Date.now();
      const waitMs = this.intervalMs - (now - this.lastTokenTime);
      if (waitMs > 0) {
        await delay(waitMs);
      }
      this.lastTokenTime = Date.now();
      this.queue.shift()!();
    }
    this.processing = false;
  }
}

// ─── 工具函数 ──────────────────────────────────────────────

/** 延迟工具（只定义一次） */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带超时保护的 fetch 封装 */
async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 卡牌查询 ──────────────────────────────────────────────

/** fuzzy 降级调用计数器，用于交错延迟避免 429 */
let fuzzyCallSeq = 0;

/**
 * 精确卡名查询（带简易重试 + 429 限速器暂停）
 * 速度快（~200ms），适合大批量导入
 *
 * 重试策略：404 不重试（真正的"没找到"），
 * 429 读 Retry-After 并暂停限速器，网络错误短暂等待后重试
 */
async function fetchExact(
  cardName: string,
  rateLimiter?: RateLimiter,
  attempt = 0
): Promise<ScryfallCard | null> {
  const url = `${BASE_URL}/cards/named?exact=${encodeURIComponent(cardName)}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
    });
    if (res.ok) return await res.json();
    // 404 是真正的"没找到"，不重试，直接降级 fuzzy
    if (res.status === 404) return null;
    // 429：读 Retry-After 头，暂停限速器，等够再重试
    if (res.status === 429 && rateLimiter && attempt < 2) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "30", 10) || 30;
      const waitMs = retryAfter * 1000 + jitter(500);
      console.warn(`[Scryfall] exact "${cardName}" 429, 暂停限速器 ${retryAfter}s (${attempt + 1}/2)`);
      rateLimiter.pause(waitMs);
      await delay(waitMs);
      return fetchExact(cardName, rateLimiter, attempt + 1);
    }
    // 其他错误（5xx 等）：短暂等待后重试
    if (attempt < 2) {
      const wait = jitter(800 * (attempt + 1));
      await delay(wait);
      return fetchExact(cardName, rateLimiter, attempt + 1);
    }
    return null;
  } catch {
    if (attempt < 2) {
      const wait = jitter(800 * (attempt + 1));
      await delay(wait);
      return fetchExact(cardName, rateLimiter, attempt + 1);
    }
    return null;
  }
}

/**
 * 模糊搜索（带自动重试 + 429 限速器暂停 + 交错延迟）
 * 仅在 exact 匹配失败时作为降级方案使用
 *
 * 交错延迟：多个 fuzzy 降级时，每个按序列号 × 500ms 延迟，
 * 确保 fuzzy 调用速率约 2/s，避免触发 Scryfall 累计限流。
 */
async function fetchFuzzy(
  cardName: string,
  rateLimiter?: RateLimiter,
  attempt = 0
): Promise<ScryfallCard | null> {
  // 交错延迟：首次调用时按序列号排队，约 2/s 速率
  if (attempt === 0) {
    const mySeq = fuzzyCallSeq++;
    const staggerMs = mySeq * 500; // 2/s 的交错间隔（官方限速）
    if (staggerMs > 0) {
      console.warn(`[Scryfall] fuzzy "${cardName}" 交错延迟 ${Math.round(staggerMs)}ms (seq=${mySeq})`);
      await delay(staggerMs);
    }
  }
  const url = `${BASE_URL}/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
    });

    if (res.status === 429 && rateLimiter && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "30", 10) || 30;
      const waitMs = retryAfter * 1000 + jitter(500);
      console.warn(`[Scryfall] fuzzy "${cardName}" 429, 暂停限速器 ${retryAfter}s (${attempt + 1}/${MAX_RETRIES})`);
      rateLimiter.pause(waitMs);
      await delay(waitMs);
      return fetchFuzzy(cardName, rateLimiter, attempt + 1);
    }

    if (!res.ok) {
      if (attempt < MAX_RETRIES) {
        const wait = jitter(800 * (attempt + 1));
        console.warn(`[Scryfall] fuzzy "${cardName}" HTTP ${res.status}, ${Math.round(wait)}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
        await delay(wait);
        return fetchFuzzy(cardName, rateLimiter, attempt + 1);
      }
      console.error(`[Scryfall] fuzzy "${cardName}" 重试 ${MAX_RETRIES} 次后仍失败`);
      return null;
    }

    return await res.json();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const wait = jitter(1000 * (attempt + 1));
      console.warn(`[Scryfall] fuzzy "${cardName}" 网络错误, ${Math.round(wait)}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
      await delay(wait);
      return fetchFuzzy(cardName, rateLimiter, attempt + 1);
    }
    console.error(`[Scryfall] fuzzy "${cardName}" 网络错误，重试耗尽:`, err);
    return null;
  }
}

/**
 * 按卡名搜索（exact 优先，失败降级 fuzzy）
 * 用于 MTGO/Plain Text 格式导入 — 无 set/code 时按名字查找
 *
 * 策略：先调用 exact 端点（快、限速宽松，~200ms），
 * 若卡名完全匹配则直接返回；若 404 则降级到 fuzzy 模糊搜索。
 * 大部分网站导出的卡名就是 Scryfall 官方名，exact 命中率 90%+。
 *
 * @param cardName 卡牌名称
 * @param rateLimiter 可选限速器，传入后遇到 429 会暂停整个限速器，防止雪崩
 */
export async function searchCardByName(
  cardName: string,
  rateLimiter?: RateLimiter,
): Promise<ScryfallCard | null> {
  // 1. 先尝试 exact 精确匹配（快速）
  const exactResult = await fetchExact(cardName, rateLimiter);
  if (exactResult) return exactResult;

  // 2. exact 失败，降级到 fuzzy 模糊搜索
  console.warn(`[Scryfall] exact 未找到 "${cardName}"，降级 fuzzy`);
  return fetchFuzzy(cardName, rateLimiter);
}

/**
 * 按 Set Code + Collector Number 查询单张卡牌（带自动重试 + 429 限速器暂停）
 * 用于导入/添加卡牌流程
 */
export async function quickFetchCard(
  setCode: string,
  collectorNumber: string,
  rateLimiter?: RateLimiter,
  attempt = 0
): Promise<ScryfallCard | null> {
  const url = `${BASE_URL}/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
    });

    if (res.status === 429 && rateLimiter && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "30", 10) || 30;
      const waitMs = retryAfter * 1000 + jitter(500);
      console.warn(`[Scryfall] ${setCode}/${collectorNumber} 429, 暂停限速器 ${retryAfter}s (${attempt + 1}/${MAX_RETRIES})`);
      rateLimiter.pause(waitMs);
      await delay(waitMs);
      return quickFetchCard(setCode, collectorNumber, rateLimiter, attempt + 1);
    }

    if (!res.ok) {
      if (attempt < MAX_RETRIES) {
        const wait = jitter(800 * (attempt + 1));
        console.warn(`[Scryfall] ${setCode}/${collectorNumber} HTTP ${res.status}, ${Math.round(wait)}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
        await delay(wait);
        return quickFetchCard(setCode, collectorNumber, rateLimiter, attempt + 1);
      }
      console.error(`[Scryfall] ${setCode}/${collectorNumber} 重试 ${MAX_RETRIES} 次后仍失败`);
      return null;
    }

    return await res.json();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const wait = jitter(1000 * (attempt + 1));
      console.warn(`[Scryfall] ${setCode}/${collectorNumber} 网络错误, ${Math.round(wait)}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
      await delay(wait);
      return quickFetchCard(setCode, collectorNumber, rateLimiter, attempt + 1);
    }
    console.error(`[Scryfall] ${setCode}/${collectorNumber} 网络错误，重试耗尽:`, err);
    return null;
  }
}

// ─── 印刷版本查询 ──────────────────────────────────────────

/**
 * 获取卡牌的所有印刷版本（分页 + 重试）
 * 用于模糊匹配缓存、补全缓存、切换印刷版本
 */
export async function fetchAllPrintings(
  cardName: string,
  attempt = 0
): Promise<Printing[]> {
  const printings: Printing[] = [];
  let pageUrl = `${BASE_URL}/cards/search?q=!"${encodeURIComponent(cardName)}"+unique:prints&order=released`;

  while (pageUrl) {
    await delay(MIN_DELAY_MS);
    try {
      const res = await fetchWithTimeout(pageUrl, {
        headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
      });

      if (res.status === 404) break;

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const wait = Math.min(2000 * (attempt + 1), 4000);
        console.warn(`[Scryfall] ${cardName} 429, ${wait}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
        await delay(wait);
        return fetchAllPrintings(cardName, attempt + 1);
      }

      if (!res.ok) {
        console.warn(`[Scryfall] ${cardName} HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      for (const card of data.data || []) {
        const artist =
          card.artist ||
          card.card_faces?.[0]?.artist ||
          "Unknown";
        const imageUrl =
          card.image_uris?.small ||
          card.card_faces?.[0]?.image_uris?.small ||
          null;

        printings.push({
          artist,
          set: card.set,
          set_name: card.set_name,
          collector_number: card.collector_number,
          image_url: imageUrl,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    } catch {
      if (attempt < MAX_RETRIES) {
        await delay(1000 * (attempt + 1));
        return fetchAllPrintings(cardName, attempt + 1);
      }
      break;
    }
  }

  return printings;
}