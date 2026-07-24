/**
 * Scryfall API 工具函数
 *
 * 规范：
 * - 每次请求至少 100ms 间隔
 * - 自定义 User-Agent
 * - 按 Set Code + Collector Number 精准查询
 * - 合作画师拆分 (N & M → ["N", "M"])
 */

const USER_AGENT = "MTG-Signature-Tracker/1.0 (personal-tool@mtg)";
const BASE_URL = "https://api.scryfall.com";
const MIN_DELAY_MS = 100;

/** 延迟工具 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * 按 Set Code + Collector Number 查询单张卡牌
 * 内置 100ms 最小延迟
 */
export async function fetchCardBySetAndNumber(
  setCode: string,
  collectorNumber: string
): Promise<ScryfallCard | null> {
  const startTime = Date.now();

  try {
    const url = `${BASE_URL}/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}`;
    console.log(`[Scryfall] GET ${url}`);

    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (res.status === 404) {
      console.warn(`[Scryfall] 未找到: ${setCode}/${collectorNumber}`);
      return null;
    }

    if (!res.ok) {
      // 如果是 429 速率限制，等待后重试
      if (res.status === 429) {
        console.warn("[Scryfall] 触发速率限制，等待 2 秒后重试...");
        await delay(2000);
        return fetchCardBySetAndNumber(setCode, collectorNumber);
      }
      console.error(`[Scryfall] HTTP ${res.status} for ${setCode}/${collectorNumber}`);
      return null;
    }

    const card: ScryfallCard = await res.json();

    // 确保每次请求至少间隔 MIN_DELAY_MS
    const elapsed = Date.now() - startTime;
    if (elapsed < MIN_DELAY_MS) {
      await delay(MIN_DELAY_MS - elapsed);
    }

    return card;
  } catch (error) {
    console.error(`[Scryfall] 请求失败: ${setCode}/${collectorNumber}`, error);
    return null;
  }
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
 */
export function extractImageUrl(card: ScryfallCard): string | null {
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.image_uris?.png) return card.image_uris.png;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return null;
}
