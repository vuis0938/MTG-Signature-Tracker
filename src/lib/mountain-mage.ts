/**
 * Mountain Mage Signatures 数据获取与解析
 *
 * 从 Google Docs 公开文档抓取签名时间表，解析艺术家名单与状态。
 * 供 /api/events/mountain-mage 和 /api/events 聚合使用。
 */

const GOOGLE_DOC_ID = "1Z695_k0Cvc458BsM540keBfV2B0Han-JKQIZC6DaCfY";
const GOOGLE_DOC_URL = `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/export?format=txt`;
const UA = "MTG-Signature-Tracker/1.0";

export interface MountainMageArtist {
  name: string;
  status: "in_progress" | "upcoming" | "unknown";
  notes?: string;
}

interface MountainMageCache {
  data: MountainMageArtist[];
  rawText: string;
  fetchedAt: number;
}

let cache: MountainMageCache | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

/**
 * 解析 Google Docs 导出的文本内容
 */
function parseDocContent(text: string): MountainMageArtist[] {
  const lines = text.split("\n");
  const artists: MountainMageArtist[] = [];
  const seen = new Set<string>();

  const artistPattern = /^[A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 3) continue;

    // 跳过标题行
    if (
      /^(Q[1-4]|SIGNING|SCHEDULE|UPDATE|UPCOMING|CURRENT|STATUS|DEADLINE|WINDOW)/i.test(line) ||
      /^\d+[\.\)]\s/.test(line)
    ) {
      continue;
    }

    const match = line.match(artistPattern);
    if (!match) continue;

    const name = match[0].trim();

    const excludeWords = [
      "Next Date", "Signing In", "Signing Window", "Signing Schedule",
      "Deadline", "Status", "MountainMage", "Please Note", "Important",
      "Thank You", "Shipping", "Return", "Contact", "Email",
      "The Following", "Artists Will", "Cards Must", "All Cards",
    ];
    if (excludeWords.some((w) => name.startsWith(w))) continue;

    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    let status: MountainMageArtist["status"] = "unknown";
    const lowerLine = line.toLowerCase();

    if (
      lowerLine.includes("in progress") ||
      lowerLine.includes("in-progress") ||
      lowerLine.includes("signing now") ||
      lowerLine.includes("currently signing")
    ) {
      status = "in_progress";
    } else if (
      lowerLine.includes("next date") ||
      lowerLine.includes("tba") ||
      lowerLine.includes("tbd") ||
      lowerLine.includes("to be announced") ||
      lowerLine.includes("upcoming")
    ) {
      status = "upcoming";
    }

    artists.push({ name, status });
  }

  return artists;
}

export interface MountainMageResult {
  success: boolean;
  artists: MountainMageArtist[];
  cached: boolean;
  stale?: boolean;
  /** 调试用：原始文本内容 */
  rawText?: string;
  error?: string;
}

/**
 * 获取 Mountain Mage 签名时间表（带缓存）
 */
export async function fetchMountainMageArtists(): Promise<MountainMageResult> {
  // 检查缓存
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { success: true, artists: cache.data, cached: true, rawText: cache.rawText };
  }

  try {
    const res = await fetch(GOOGLE_DOC_URL, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[MountainMage] Google Docs HTTP ${res.status}`);
      if (cache) {
        return { success: true, artists: cache.data, cached: true, stale: true, rawText: cache.rawText };
      }
      return { success: false, artists: [], cached: false, error: "无法获取签名时间表" };
    }

    const text = await res.text();

    if (!text || text.length < 10) {
      console.warn("[MountainMage] Google Docs 返回空内容");
      if (cache) {
        return { success: true, artists: cache.data, cached: true, stale: true, rawText: cache.rawText };
      }
      return { success: false, artists: [], cached: false, error: "签名时间表为空" };
    }

    const artists = parseDocContent(text);
    cache = { data: artists, rawText: text, fetchedAt: Date.now() };

    console.log(`[MountainMage] 解析到 ${artists.length} 位艺术家`);
    return { success: true, artists, cached: false, rawText: text };
  } catch (error) {
    console.error("[MountainMage]", error);
    if (cache) {
      return { success: true, artists: cache.data, cached: true, stale: true, rawText: cache.rawText };
    }
    return { success: false, artists: [], cached: false, error: "获取数据失败" };
  }
}