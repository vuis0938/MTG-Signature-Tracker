/**
 * 匹配工具函数
 *
 * 从匹配页面提取的纯函数，不依赖 React 状态或浏览器 API。
 * 可直接进行单元测试。
 */

// ─── 类型定义 ──────────────────────────────────────────────

import type { Printing } from "@/types";

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

/** 构建 NFD 规范化 key → 原始 key 映射 */
export function buildNormalizedMap(dbKeys: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const dbKey of dbKeys) {
    const normalized = dbKey.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
  const normalizedKey = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
 * 匹配页面状态切换循环。
 * 0(待签) → 3(心动) → 1(送签中) → 0(待签)
 * 2(已签) → 3(心动)  — 已签卡重新参加活动时从心动开始
 */
const STATUS_CYCLE: Record<number, number> = { 0: 3, 3: 1, 1: 0, 2: 3 };

/** 获取下一个状态值 */
export function getNextStatus(current: number): number {
  return STATUS_CYCLE[current] ?? 0;
}