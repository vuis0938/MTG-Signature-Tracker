/**
 * 匹配工具函数
 *
 * 从匹配页面提取的纯函数，不依赖 React 状态或浏览器 API。
 * 可直接进行单元测试。
 */

// ─── 类型定义 ──────────────────────────────────────────────

import type { Printing, CardEntry, FuzzyCardEntry } from "@/types";

/** 模糊匹配 API 返回结构 */
export interface FuzzyApiResponse {
  success: boolean;
  cardMap?: Record<string, {
    card_name: string;
    printings: Printing[];
    allArtists: string[];
  }>;
}

// ─── 画家名解析 ──────────────────────────────────────────

/** 安全解析 artist_names：兼容 string[] 和 Supabase 可能返回的 string */
export function normalizeArtists(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [raw];
  }
  return [];
}

// ─── 变音符号规范化 ──────────────────────────────────────

/**
 * 安全地规范化 Unicode 字符串（NFD 分解变音符号）。
 *
 * 部分浏览器（如 UC）的 JavaScript 引擎 ICU 实现不完整，
 * 调用 normalize("NFD") 会抛出 "Internal error. Icu error."。
 * 此函数捕获异常后降级为手动移除常见变音符号。
 */
export function safeNormalize(str: string): string {
  try {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // UC 浏览器 ICU 崩溃时的降级方案：手动移除常见拉丁变音字符
    return str
      .replace(/[àáâãäå]/g, "a")
      .replace(/[ÀÁÂÃÄÅ]/g, "A")
      .replace(/[èéêë]/g, "e")
      .replace(/[ÈÉÊË]/g, "E")
      .replace(/[ìíîï]/g, "i")
      .replace(/[ÌÍÎÏ]/g, "I")
      .replace(/[òóôõö]/g, "o")
      .replace(/[ÒÓÔÕÖ]/g, "O")
      .replace(/[ùúûü]/g, "u")
      .replace(/[ÙÚÛÜ]/g, "U")
      .replace(/[ýÿ]/g, "y")
      .replace(/[ÝŸ]/g, "Y")
      .replace(/ñ/g, "n")
      .replace(/Ñ/g, "N")
      .replace(/[ç]/g, "c")
      .replace(/[Ç]/g, "C")
      .replace(/[š]/g, "s")
      .replace(/[Š]/g, "S")
      .replace(/[ž]/g, "z")
      .replace(/[Ž]/g, "Z")
      .replace(/[ćč]/g, "c")
      .replace(/[ĆČ]/g, "C")
      .replace(/[đ]/g, "d")
      .replace(/[Đ]/g, "D")
      .replace(/[ł]/g, "l")
      .replace(/[Ł]/g, "L")
      .replace(/[ń]/g, "n")
      .replace(/[Ń]/g, "N")
      .replace(/[ś]/g, "s")
      .replace(/[Ś]/g, "S")
      .replace(/[ź]/g, "z")
      .replace(/[Ź]/g, "Z")
      .replace(/[æ]/g, "ae")
      .replace(/[Æ]/g, "AE")
      .replace(/[œ]/g, "oe")
      .replace(/[Œ]/g, "OE")
      .replace(/[ø]/g, "o")
      .replace(/[Ø]/g, "O")
      .replace(/[ß]/g, "ss");
  }
}

/** 构建 NFD 规范化 key → 原始 key 映射 */
export function buildNormalizedMap(dbKeys: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const dbKey of dbKeys) {
    const normalized = safeNormalize(dbKey);
    if (!map.has(normalized)) {
      map.set(normalized, dbKey);
    }
  }
  return map;
}

// ─── 画家名匹配 ──────────────────────────────────────────

/**
 * 在候选画家中查找匹配。
 * 规则（按优先级）：
 *   1. 精确匹配（大小写不敏感）
 *   2. 首尾名匹配：如 "Dan Scott" 匹配 "Dan Murayama Scott"
 *   3. 变音符号规范化匹配：如 "Milivoj Ceran" 匹配 "Milivoj Ćeran"
 */
export function findMatchingArtist(
  parsedArtist: string,
  dbKeys: string[],
  normalizedMap?: Map<string, string>
): string | null {
  const key = parsedArtist.toLowerCase().trim();
  if (dbKeys.includes(key)) return key;

  const words = key.split(/\s+/).filter(Boolean);

  // 规则 2：首尾名匹配
  if (words.length >= 2) {
    const first = words[0];
    const last = words[words.length - 1];
    for (const dbKey of dbKeys) {
      const dbWords = dbKey.split(/\s+/).filter(Boolean);
      if (dbWords.length >= 2) {
        if (dbWords[0] === first && dbWords[dbWords.length - 1] === last) {
          return dbKey;
        }
      }
    }
  }

  // 规则 3：变音符号规范化
  const map = normalizedMap ?? buildNormalizedMap(dbKeys);
  const normalizedKey = safeNormalize(key);
  return map.get(normalizedKey) || null;
}

// ─── 卡牌去重 ────────────────────────────────────────────

/** 判断两张卡牌是否是同一印刷版本（同名+同系列+同编号） */
export function isSamePrinting(
  a: { card_name: string; set_code: string; collector_number: string },
  b: { card_name: string; set_code: string; collector_number: string }
): boolean {
  return a.card_name === b.card_name && a.set_code === b.set_code && a.collector_number === b.collector_number;
}

// ─── 状态切换 ────────────────────────────────────────────

/**
 * 套牌管理页状态循环：0(未签) → 1(送签中) → 2(已签) → 0(未签)
 * 不含心动状态，专注管理签绘进度。
 */
const DECK_STATUS_CYCLE: Record<number, number> = { 0: 1, 1: 2, 2: 0 };

/** 套牌管理页：获取下一个状态值 */
export function getNextDeckStatus(current: number): number {
  return DECK_STATUS_CYCLE[current] ?? 0;
}

/**
 * 匹配页状态循环：0(未签) → 3(心动) → 1(送签中) → 0(未签)
 * 不含已签状态，专注活动现场标记意向。
 */
const MATCH_STATUS_CYCLE: Record<number, number> = { 0: 3, 3: 1, 1: 0 };

/** 匹配页：获取下一个状态值 */
export function getNextMatchStatus(current: number): number {
  return MATCH_STATUS_CYCLE[current] ?? 0;
}

// ─── 模糊匹配兜底 ────────────────────────────────────────

/**
 * 模糊匹配结果与活动画家做最终匹配，并兜底确保精确匹配结果 100% 包含。
 *
 * 这是模糊匹配流程的最后一步，也是最关键的安全网：
 * 之前出现过"联合搜索两个套牌漏卡"的 bug，就是因为精确匹配结果
 * 没有被完整合并到模糊匹配结果中。
 */
export function matchAgainstArtists(
  parsedArtists: string[],
  expandedArtistCards: Map<string, FuzzyCardEntry[]>,
  exactMatchedKeys: Set<string>,
  artistDbKeys: string[],
  artistNormalizedMap: Map<string, string>,
  artistCards: Map<string, CardEntry[]>
): { newFuzzyMatched: Map<string, FuzzyCardEntry[]>; newUnmatched: string[] } {
  // 1. 构建小写 key → entries 映射（去重合并）
  const expandedKeyMap = new Map<string, FuzzyCardEntry[]>();
  for (const [artist, entries] of expandedArtistCards) {
    const key = artist.toLowerCase().trim();
    const existing = expandedKeyMap.get(key) || [];
    for (const e of entries) {
      if (!existing.some((x) => isSamePrinting(x, e))) {
        existing.push(e);
      }
    }
    expandedKeyMap.set(key, existing);
  }

  const newFuzzyMatched = new Map<string, FuzzyCardEntry[]>();
  const newUnmatched: string[] = [];
  const expandedDbKeys = [...expandedKeyMap.keys()];
  const expandedNormalizedMap = buildNormalizedMap(expandedDbKeys);

  // 2. 用三级匹配规则匹配活动画家
  for (const parsedArtist of parsedArtists) {
    const matchedKey = findMatchingArtist(parsedArtist, expandedDbKeys, expandedNormalizedMap);
    if (matchedKey) {
      newFuzzyMatched.set(parsedArtist, expandedKeyMap.get(matchedKey) || []);
    } else {
      newUnmatched.push(parsedArtist);
    }
  }

  // 3. 兜底：确保精确匹配结果 100% 包含
  for (const parsedArtist of parsedArtists) {
    if (newFuzzyMatched.has(parsedArtist)) continue;
    const key = findMatchingArtist(parsedArtist, artistDbKeys, artistNormalizedMap);
    if (!key || !exactMatchedKeys.has(key)) continue;

    const exactCards = artistCards.get(key) || [];
    if (exactCards.length === 0) continue;

    const displayArtist = normalizeArtists(exactCards[0].artist_names)[0] || key;
    newFuzzyMatched.set(parsedArtist, exactCards.map((c) => ({
      card_name: c.card_name, set_code: c.set_code, set_name: "",
      collector_number: c.collector_number, image_url: c.image_url,
      artist: displayArtist, deckCard: c,
    })));
    const idx = newUnmatched.indexOf(parsedArtist);
    if (idx !== -1) newUnmatched.splice(idx, 1);
  }

  return { newFuzzyMatched, newUnmatched };
}