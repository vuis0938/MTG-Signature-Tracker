/**
 * 共享 Scryfall API 客户端
 *
 * 统一所有 API 路由的 Scryfall 调用，消除重复代码。
 * 包含：限速延迟、重试逻辑、分页查询、卡牌查询。
 */

import { Printing } from "@/types";

// ─── 类型定义 ──────────────────────────────────────────────

/** Scryfall 返回的卡牌数据结构（关键字段） */
export interface ScryfallCard {
  id: string;
  name: string;
  set_name: string;
  set: string; // set code
  collector_number: string;
  artist: string;
  image_uris?: {
    normal: string;
    small: string;
    png: string;
  };
  card_faces?: Array<{
    artist: string;
    image_uris?: { normal: string; small: string; png: string };
  }>;
}

// ─── 工具函数 ──────────────────────────────────────────────

/**
 * 解析画家名，拆分合作画师
 * 例: "John Avon & Kev Walker" → ["John Avon", "Kev Walker"]
 * 例: "Mark Tedin and John Avon" → ["Mark Tedin", "John Avon"]
 * 例: "Alayna Danner, John Avon" → ["Alayna Danner", "John Avon"]
 */
export function splitArtists(raw: string): string[] {
  if (!raw) return ["Unknown Artist"];

  return raw
    .split(/\s*&\s*|\s+and\s+|\s*,\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 从 ScryfallCard 提取统一的画家数组
 * 处理普通卡和双面牌
 */
export function extractArtists(card: ScryfallCard): string[] {
  const artistSet = new Set<string>();

  // 正面画家
  if (card.artist) {
    splitArtists(card.artist).forEach((a) => artistSet.add(a));
  }

  // 双面牌的背面画家
  if (card.card_faces) {
    for (const face of card.card_faces) {
      if (face.artist) {
        splitArtists(face.artist).forEach((a) => artistSet.add(a));
      }
    }
  }

  const artists = Array.from(artistSet);
  return artists.length > 0 ? artists : ["Unknown Artist"];
}

/**
 * 从 ScryfallCard 提取最好的图片 URL
 * 优先使用 small 尺寸（146×204），缩略图场景足够且传输量减少约 70%
 */
export function extractImageUrl(card: ScryfallCard): string | null {
  if (card.image_uris?.small) return card.image_uris.small;
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.small) return card.card_faces[0].image_uris.small;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return null;
}

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

// ─── 批量查询 ─────────────────────────────────────────────

/** Scryfall Collection 接口标识符 */
export interface CardIdentifier {
  /** 卡名（始终存在，用于 not_found 时降级 fuzzy） */
  name: string;
  /** 有 set code 时用精确查询，否则用卡名查询 */
  set?: string;
  collector_number?: string;
}

/**
 * 在 batch 中定位 not_found 项的原始索引
 *
 * Scryfall not_found 不含 identifier_index，需要通过匹配标识符定位。
 * 提取为独立函数，避免两处重复遍历。
 */
function findNotfoundIndex(
  nf: Record<string, unknown>,
  batch: CardIdentifier[]
): number {
  for (let i = 0; i < batch.length; i++) {
    const id = batch[i];
    if (nf.name && id.name === nf.name) return i;
    if (nf.set && nf.collector_number && id.set === nf.set && id.collector_number === nf.collector_number) return i;
  }
  return -1;
}

/**
 * 批量查询卡牌（适用于所有格式，统一入口）
 *
 * 使用 /cards/collection 接口，一次最多查 75 张。
 * 支持混合标识符：有 set+number 的精确查询，没 set 的按卡名查询。
 * 100 张牌只需 2 次请求，彻底消除 429 限速问题。
 *
 * 返回结果按输入顺序对应，找不到返回 null。
 */
export async function batchSearch(
  ids: CardIdentifier[],
  rateLimiter?: RateLimiter,
): Promise<(ScryfallCard | null)[]> {
  const BATCH_SIZE = 75;
  const batches: CardIdentifier[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    batches.push(ids.slice(i, i + BATCH_SIZE));
  }

  const results: (ScryfallCard | null)[] = new Array(ids.length).fill(null);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    if (rateLimiter) {
      await rateLimiter.acquire();
    }

    const batchResults = await executeBatch(batch, batchIndex, BATCH_SIZE, ids, rateLimiter, 0);
    for (let i = 0; i < batchResults.length; i++) {
      results[batchIndex * BATCH_SIZE + i] = batchResults[i];
    }
  }

  return results;
}

/**
 * 执行单批查询（内部含重试，429 只重试当前 batch，不丢弃已查询结果）
 */
async function executeBatch(
  batch: CardIdentifier[],
  batchIndex: number,
  batchSize: number,
  ids: CardIdentifier[],
  rateLimiter?: RateLimiter,
  attempt = 0,
): Promise<(ScryfallCard | null)[]> {
  const batchResults: (ScryfallCard | null)[] = new Array(batch.length).fill(null);

  // 构建 Scryfall 标识符：有 set 用 set+number，没 set 用 name
  const identifiers = batch.map((id) =>
    id.set && id.collector_number
      ? { set: id.set, collector_number: id.collector_number }
      : { name: id.name }
  );

  try {
    const res = await fetchWithTimeout(`${BASE_URL}/cards/collection`, {
      method: "POST",
      headers: {
        "User-Agent": SCRYFALL_UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ identifiers }),
    });

    // 429：只重试当前 batch，不影响已完成的 batch
    if (res.status === 429 && rateLimiter && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "30", 10) || 30;
      const waitMs = retryAfter * 1000 + jitter(500);
      console.warn(`[Scryfall] batch ${batchIndex + 1} 429, 暂停限速器 ${retryAfter}s (${attempt + 1}/${MAX_RETRIES})`);
      rateLimiter.pause(waitMs);
      await delay(waitMs);
      return executeBatch(batch, batchIndex, batchSize, ids, rateLimiter, attempt + 1);
    }

    if (!res.ok) {
      console.error(`[Scryfall] batch ${batchIndex + 1} HTTP ${res.status}, fallback to individual queries`);
      return Promise.all(
        batch.map(async (id) => searchCardByName(id.name, rateLimiter))
      );
    }

    const data = await res.json();

    // 一次遍历 not_found，同时构建 notFoundSet 和 fuzzy 降级任务
    const notFoundSet = new Set<number>();
    const fuzzyTasks: Array<{ index: number; name: string }> = [];

    for (const nf of data.not_found || []) {
      const idx = findNotfoundIndex(nf, batch);
      if (idx >= 0) {
        notFoundSet.add(idx);
        fuzzyTasks.push({ index: idx, name: ids[batchIndex * batchSize + idx].name });
      }
    }

    // 填充找到的卡牌
    let dataIdx = 0;
    for (let i = 0; i < batch.length; i++) {
      if (!notFoundSet.has(i)) {
        batchResults[i] = data.data[dataIdx++] || null;
      }
    }

    // 并行降级 fuzzy（比串行快）
    if (fuzzyTasks.length > 0 && rateLimiter) {
      console.warn(`[Scryfall] batch ${batchIndex + 1}: ${fuzzyTasks.length} not found, fallback fuzzy`);
      const fuzzyResults = await Promise.all(
        fuzzyTasks.map((t) => fetchFuzzy(t.name, rateLimiter))
      );
      for (let i = 0; i < fuzzyTasks.length; i++) {
        batchResults[fuzzyTasks[i].index] = fuzzyResults[i];
      }
    }
  } catch (err) {
    console.error(`[Scryfall] batch ${batchIndex + 1} network error:`, err);
    return Promise.all(
      batch.map(async (id) => searchCardByName(id.name, rateLimiter))
    );
  }

  return batchResults;
}

// ─── 印刷版本查询 ──────────────────────────────────────────

/** 检查卡牌名称是否精确匹配目标（排除双面卡/裂片卡中仅一面同名的情况） */
function matchesCardName(card: Record<string, unknown>, target: string): boolean {
  return (card.name as string || "") === target;
}

/**
 * 获取卡牌的所有印刷版本（分页 + 重试）
 * 用于模糊匹配缓存、补全缓存、切换印刷版本
 */
export async function fetchAllPrintings(
  cardName: string,
  attempt = 0
): Promise<Printing[]> {
  const printings: Printing[] = [];
  const target = cardName.trim();
  let pageUrl = `${BASE_URL}/cards/search?q=!"${encodeURIComponent(target)}"+unique:prints&order=released`;

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
        // 过滤双面卡/裂片卡：只有名称精确匹配的才加入
        if (!matchesCardName(card, target)) continue;

        const artist =
          card.artist ||
          card.card_faces?.[0]?.artist ||
          "Unknown";
        const imageUrl =
          card.image_uris?.small ||
          card.image_uris?.normal ||
          card.card_faces?.[0]?.image_uris?.small ||
          card.card_faces?.[0]?.image_uris?.normal ||
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