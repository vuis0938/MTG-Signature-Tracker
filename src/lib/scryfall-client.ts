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
const MAX_RETRIES = 2;

// ─── 工具函数 ──────────────────────────────────────────────

/** 延迟工具（只定义一次） */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 卡牌查询 ──────────────────────────────────────────────

/**
 * 按 Set Code + Collector Number 查询单张卡牌（带自动重试）
 * 用于导入/添加卡牌流程
 */
export async function quickFetchCard(
  setCode: string,
  collectorNumber: string,
  attempt = 0
): Promise<ScryfallCard | null> {
  const url = `${BASE_URL}/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
    });

    if (!res.ok) {
      if (attempt < MAX_RETRIES) {
        const wait = res.status === 429 ? 2000 : 1000 * (attempt + 1);
        console.warn(`[Scryfall] ${setCode}/${collectorNumber} HTTP ${res.status}, ${wait}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
        await delay(wait);
        return quickFetchCard(setCode, collectorNumber, attempt + 1);
      }
      console.error(`[Scryfall] ${setCode}/${collectorNumber} 重试 ${MAX_RETRIES} 次后仍失败`);
      return null;
    }

    return await res.json();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const wait = 1000 * (attempt + 1);
      console.warn(`[Scryfall] ${setCode}/${collectorNumber} 网络错误, ${wait}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
      await delay(wait);
      return quickFetchCard(setCode, collectorNumber, attempt + 1);
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
      const res = await fetch(pageUrl, {
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