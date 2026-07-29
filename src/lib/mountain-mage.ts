/**
 * Mountain Mage Signatures 数据获取与解析
 *
 * 从 Google Docs 公开文档抓取签名时间表，按章节和截止日期分组。
 * 供 /api/events/mountain-mage 和 /api/events 聚合使用。
 */

const GOOGLE_DOC_ID = "1Z695_k0Cvc458BsM540keBfV2B0Han-JKQIZC6DaCfY";
const GOOGLE_DOC_URL = `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/export?format=txt`;
const UA = "MTG-Signature-Tracker/1.0";

// ─── 类型定义 ──────────────────────────────────────────────

export interface MountainMageArtist {
  name: string;
  status: "in_progress" | "upcoming" | "unknown";
  notes?: string;
}

export interface MountainMageSection {
  /** 章节名称，如 "Q3 2026"、"DragonCon 2026" */
  name: string;
  /** 截止日期 ISO 字符串，如 "2026-08-28"；无截止日期则为 null */
  deadline: string | null;
  /** 状态 */
  status: "in_progress" | "upcoming";
  /** 该章节下的艺术家名单 */
  artists: string[];
}

interface MountainMageCache {
  sections: MountainMageSection[];
  /** 向后兼容的扁平艺术家列表 */
  artists: MountainMageArtist[];
  rawText: string;
  fetchedAt: number;
}

let cache: MountainMageCache | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

// ─── 月份名称 → 数字 ──────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * 从章节标题中提取截止日期
 * 匹配模式:
 *   "deadline August 28th"
 *   "hard deadline of August 31st"
 *   "deadline September 15th"
 */
function parseDeadline(line: string, defaultYear: number): string | null {
  const m = line.match(/deadline\s+(?:of\s+)?([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (!m) return null;

  const monthName = m[1].toLowerCase();
  const day = parseInt(m[2], 10);
  const month = MONTH_MAP[monthName];

  if (!month) return null;

  return `${defaultYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 从章节标题中提取年份
 */
function parseYear(line: string): number {
  const m = line.match(/\b(20\d{2})\b/);
  if (m) return parseInt(m[1], 10);
  return new Date().getFullYear();
}

// ─── 排除词 ────────────────────────────────────────────────

const excludePatterns = [
  "shipping", "please use the following", "please note",
  "signing schedule", "signing in", "signing window",
  "next date", "thank you", "return", "contact", "email",
  "cards must", "all cards", "the following", "artists will",
  "mountainmage", "important", "upcoming signings",
  "and info/rules", "info/rules",
];

// ─── 章节标题识别 ──────────────────────────────────────────

/** 有明确截止日期的章节（如 Q3 2026 signings） */
const SECTION_WITH_DEADLINE =  /^(Q[1-4]\s+\d{4}|DragonCon\s+\d{4}|Commander\s+Sealed\s+\d{4})/i;

/** 子章节（如 Tokyo MTG），继承父章节截止日期 */
const SUBSECTION = /^(Tokyo\s+MTG|Kazuki)/i;

/** 进行中章节 */
const IN_PROGRESS_SECTION = /^IN[\s-]PROGRESS/i;

/**
 * 解析 Google Docs 导出的文本内容，按章节分组
 */
function parseDocContent(text: string): { sections: MountainMageSection[]; artists: MountainMageArtist[] } {
  const lines = text.split(/\r?\n/);
  const sections: MountainMageSection[] = [];
  const allArtists: MountainMageArtist[] = [];
  const seen = new Set<string>();

  // 当前章节上下文
  let currentSectionName = "";
  let currentDeadline: string | null = null;
  let currentStatus: "in_progress" | "upcoming" = "upcoming";
  let currentArtists: string[] = [];

  function flushSection() {
    if (currentSectionName && currentArtists.length > 0) {
      sections.push({
        name: currentSectionName,
        deadline: currentDeadline,
        status: currentStatus,
        artists: [...currentArtists],
      });
    }
    currentArtists = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 3) continue;

    // ── 检测章节标题 ──
    if (SECTION_WITH_DEADLINE.test(line)) {
      flushSection();
      // 提取纯名称（去掉 signings、括号内容等）
      const nameMatch = line.match(/^([A-Z][A-Za-z0-9\s]+?)(?:\s+signings?|\s*\(|$)/i);
      currentSectionName = nameMatch ? nameMatch[1].trim() : line;
      const year = parseYear(line);
      currentDeadline = parseDeadline(line, year);
      currentStatus = "upcoming";
      continue;
    }

    if (IN_PROGRESS_SECTION.test(line)) {
      flushSection();
      currentSectionName = "进行中签名";
      currentDeadline = null;
      currentStatus = "in_progress";
      continue;
    }

    if (SUBSECTION.test(line)) {
      // 子章节：继承父章节的截止日期，但归入父章节
      // 不 flush，继续往 currentArtists 追加
      continue;
    }

    // ── 匹配艺术家行（以 "* " 开头）──
    const artistMatch = line.match(/^\s*\*\s+(.+)$/);
    if (!artistMatch) continue;

    const rawName = artistMatch[1].trim();

    // 提取括号前的纯名称
    let name = rawName;
    const parenIdx = rawName.indexOf("(");
    if (parenIdx > 0) {
      name = rawName.slice(0, parenIdx).trim();
    }

    if (name.length < 3) continue;

    const lowerName = name.toLowerCase();
    if (excludePatterns.some((w) => lowerName.includes(w))) continue;

    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    currentArtists.push(name);
    allArtists.push({ name, status: currentStatus });
  }

  // 最后刷出当前章节
  flushSection();

  return { sections, artists: allArtists };
}

// ─── 导出接口 ──────────────────────────────────────────────

export interface MountainMageResult {
  success: boolean;
  /** 按章节分组的艺术家 */
  sections: MountainMageSection[];
  /** 向后兼容：扁平艺术家列表 */
  artists: MountainMageArtist[];
  cached: boolean;
  stale?: boolean;
  rawText?: string;
  error?: string;
}

/**
 * 获取 Mountain Mage 签名时间表（带缓存）
 */
export async function fetchMountainMageArtists(forceRefresh = false): Promise<MountainMageResult> {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return {
      success: true,
      sections: cache.sections,
      artists: cache.artists,
      cached: true,
      rawText: cache.rawText,
    };
  }

  try {
    const res = await fetch(GOOGLE_DOC_URL, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[MountainMage] Google Docs HTTP ${res.status}`);
      if (cache) {
        return {
          success: true,
          sections: cache.sections,
          artists: cache.artists,
          cached: true,
          stale: true,
          rawText: cache.rawText,
        };
      }
      return { success: false, sections: [], artists: [], cached: false, error: "无法获取签名时间表" };
    }

    const text = await res.text();

    if (!text || text.length < 10) {
      console.warn("[MountainMage] Google Docs 返回空内容");
      if (cache) {
        return {
          success: true,
          sections: cache.sections,
          artists: cache.artists,
          cached: true,
          stale: true,
          rawText: cache.rawText,
        };
      }
      return { success: false, sections: [], artists: [], cached: false, error: "签名时间表为空" };
    }

    const { sections, artists } = parseDocContent(text);
    cache = { sections, artists, rawText: text, fetchedAt: Date.now() };

    console.log(`[MountainMage] 解析到 ${sections.length} 个章节、${artists.length} 位艺术家`);
    return { success: true, sections, artists, cached: false, rawText: text };
  } catch (error) {
    console.error("[MountainMage]", error);
    if (cache) {
      return {
        success: true,
        sections: cache.sections,
        artists: cache.artists,
        cached: true,
        stale: true,
        rawText: cache.rawText,
      };
    }
    return { success: false, sections: [], artists: [], cached: false, error: "获取数据失败" };
  }
}