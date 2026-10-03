/**
 * 匹配工具函数
 *
 * 从匹配页面提取的纯函数，不依赖 React 状态或浏览器 API。
 * 可直接进行单元测试。
 */

// ─── 类型定义 ──────────────────────────────────────────────

import type { Printing, ArtistCard, CardEntry, FuzzyCardEntry } from "@/types";

/** 模糊匹配 cardMap 中单张卡牌的值 */
export interface FuzzyCardInfo {
  card_name: string;
  printings: Printing[];
  allArtists: string[];
}

/** 模糊匹配 API 返回结构 */
export interface FuzzyApiResponse {
  success: boolean;
  cardMap?: Record<string, FuzzyCardInfo>;
}

/**
 * 把「画家 → 卡牌列表」的反向查询结果反转成「卡名 → 画家/印刷版本」的 cardMap。
 *
 * 每个画家查到的卡按卡名归组，该画家被 tag 进 printings[].artist 与 allArtists。
 * 这样模糊匹配 API 的返回结构保持不变，客户端 buildExpandedArtistCards 零改动。
 *
 * @param deckNames 可选：套牌中的卡名集合。反向查询返回画家的「全部卡」，
 *  必须过滤到套牌范围内，否则会把套牌里根本没有的卡误显示为「其他版本」。
 */
export function buildFuzzyCardMap(
  artistCardsMap: Map<string, ArtistCard[]>,
  deckNames?: Set<string>
): Record<string, FuzzyCardInfo> {
  const cardMap: Record<string, FuzzyCardInfo> = {};
  for (const [artist, cards] of artistCardsMap) {
    for (const card of cards) {
      // 只保留套牌中存在的卡名（同名卡才算「其他版本」，不同名卡直接丢弃）
      if (deckNames && !deckNames.has(card.name)) continue;

      const entry = cardMap[card.name] || {
        card_name: card.name,
        printings: [],
        allArtists: [],
      };
      entry.printings.push({
        artist,
        set: card.set,
        set_name: card.set_name,
        collector_number: card.collector_number,
        image_url: card.image_url,
        released_at: card.released_at,
      });
      if (!entry.allArtists.includes(artist)) {
        entry.allArtists.push(artist);
      }
      cardMap[card.name] = entry;
    }
  }
  return cardMap;
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
  dbKeys: Set<string>,
  normalizedMap?: Map<string, string>
): string | null {
  const key = parsedArtist.toLowerCase().trim();
  if (dbKeys.has(key)) return key;

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
  const map = normalizedMap ?? buildNormalizedMap([...dbKeys]);
  const normalizedKey = safeNormalize(key);
  return map.get(normalizedKey) || null;
}

// ─── 编辑距离 ──────────────────────────────────────────────

/**
 * 计算两个字符串的 Levenshtein 编辑距离（用于画家名模糊匹配）。
 * 返回把 a 变成 b 所需的最少「插入/删除/替换」次数。
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // 滚动数组节省内存
  let prev = new Array<number>(n + 1).fill(0).map((_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 名字归一化：小写 + 去变音符号 + trim（用于模糊匹配比较） */
function normalizeNameForMatch(name: string): string {
  return safeNormalize(name.toLowerCase().trim());
}

// ─── 画家名模糊匹配（三关）─────────────────────────────────

/** 名/姓氏 编辑距离阈值：超过即视为不同画家（保守，宁可漏不可错） */
export const MAX_NAME_EDIT_DISTANCE = 1;

/**
 * 三关匹配：判断输入名字与候选画家名是否为同一画家。
 *
 * 三关：
 * 1. 名（首词）与候选首词 编辑距离 ≤ MAX_NAME_EDIT_DISTANCE
 * 2. 姓（末词）与候选末词 编辑距离 ≤ MAX_NAME_EDIT_DISTANCE
 * 3. 通过前两关的候选必须唯一（防歧义，多个都过则拒）
 *
 * 单词输入当作「姓氏」，只比末词。
 * 中间词忽略（允许「少中间名」）。
 *
 * 返回唯一匹配的候选名，否则返回 null。
 */
export function matchArtistName(input: string, candidates: string[]): string | null {
  const inWords = normalizeNameForMatch(input).split(/\s+/).filter(Boolean);
  if (inWords.length === 0) return null;

  const passed: string[] = [];
  for (const c of candidates) {
    const cWords = normalizeNameForMatch(c).split(/\s+/).filter(Boolean);
    if (cWords.length === 0) continue;

    if (inWords.length === 1) {
      // 单词输入：当作姓氏，只比末词
      const lastDist = editDistance(inWords[0], cWords[cWords.length - 1]);
      if (lastDist <= MAX_NAME_EDIT_DISTANCE) passed.push(c);
    } else {
      // 多词输入：比首词 + 末词（中间词忽略）
      const firstDist = editDistance(inWords[0], cWords[0]);
      const lastDist = editDistance(inWords[inWords.length - 1], cWords[cWords.length - 1]);
      if (firstDist <= MAX_NAME_EDIT_DISTANCE && lastDist <= MAX_NAME_EDIT_DISTANCE) {
        passed.push(c);
      }
    }
  }

  return passed.length === 1 ? passed[0] : null;
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

/**
 * 构建写入数据库的 event_name 字段值。
 *
 * 规则：
 * - 非心动状态（status !== 3）→ 不写活动名，返回 null
 * - 心动状态 + 多选活动 → 不写活动名（拼接后易超 200 字符限制），返回 null
 * - 心动状态 + 单选活动 → 优先保留卡牌原有活动名，无则用当前活动名
 */
export function buildEventNameForStatus(
  newStatus: number,
  isMultiEvent: boolean,
  oldEventName: string | null,
  currentEvent: string | null,
): string | null {
  if (newStatus !== 3) return null;
  if (isMultiEvent) return null;
  return oldEventName || (currentEvent || null);
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
  artistDbKeys: Set<string>,
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
  const unmatchedSet = new Set<string>();
  const expandedKeySet = new Set(expandedKeyMap.keys());
  const expandedNormalizedMap = buildNormalizedMap([...expandedKeySet]);

  // 2. 用三级匹配规则匹配活动画家
  for (const parsedArtist of parsedArtists) {
    const matchedKey = findMatchingArtist(parsedArtist, expandedKeySet, expandedNormalizedMap);
    if (matchedKey) {
      newFuzzyMatched.set(parsedArtist, expandedKeyMap.get(matchedKey) || []);
    } else {
      unmatchedSet.add(parsedArtist);
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
    unmatchedSet.delete(parsedArtist);
  }

  return { newFuzzyMatched, newUnmatched: [...unmatchedSet] };
}