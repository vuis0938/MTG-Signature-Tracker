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
 *
 * 文档格式规则：
 * - 艺术家行以 "* " 开头（可能前面有缩进空格）
 * - 艺术家名后可能跟 "(价格信息)" 括号
 * - 章节标题如 "Q3 2026 signings"、"DragonCon 2026"、"IN-PROGRESS SIGNINGS"
 * - 子项（如 Tokyo MTG 下的艺术家）前面有额外缩进
 */
function parseDocContent(text: string): MountainMageArtist[] {
  const lines = text.split(/\r?\n/);
  const artists: MountainMageArtist[] = [];
  const seen = new Set<string>();

  let currentSection = "";

  // 排除词：如果艺术家名包含这些词，当作非艺术家行跳过
  const excludePatterns = [
    "shipping", "please use the following", "please note",
    "signing schedule", "signing in", "signing window",
    "next date", "thank you", "return", "contact", "email",
    "cards must", "all cards", "the following", "artists will",
    "mountainmage", "important", "upcoming signings",
    "and info/rules", "info/rules",
  ];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 3) continue;

    // ── 检测章节标题 ──
    // 匹配: "Q3 2026 signings", "DragonCon 2026", "Commander Sealed 2026",
    //       "IN-PROGRESS SIGNINGS", "Tokyo MTG/Kazuki signings" 等
    if (
      /^(Q[1-4]\s+\d{4}|DragonCon|Commander\s+Sealed|IN[\s-]PROGRESS|Tokyo\s+MTG)/i.test(line)
    ) {
      currentSection = line.toLowerCase();
      continue;
    }

    // ── 匹配艺术家行（以 "* " 开头）──
    const artistMatch = line.match(/^\s*\*\s+(.+)$/);
    if (!artistMatch) continue;

    const rawName = artistMatch[1].trim();

    // 提取括号前的纯名称（括号内是价格/备注）
    let name = rawName;
    const parenIdx = rawName.indexOf("(");
    if (parenIdx > 0) {
      name = rawName.slice(0, parenIdx).trim();
    }

    // 名称太短，跳过
    if (name.length < 3) continue;

    // 排除非艺术家行
    const lowerName = name.toLowerCase();
    if (excludePatterns.some((w) => lowerName.includes(w))) continue;

    // 去重
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    // ── 根据章节判断状态 ──
    let status: MountainMageArtist["status"] = "unknown";
    if (currentSection.includes("in-progress") || currentSection.includes("in progress")) {
      status = "in_progress";
    } else if (
      currentSection.includes("q3") ||
      currentSection.includes("q4") ||
      currentSection.includes("dragoncon") ||
      currentSection.includes("commander sealed")
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
export async function fetchMountainMageArtists(forceRefresh = false): Promise<MountainMageResult> {
  // 检查缓存（forceRefresh 时跳过缓存）
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
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