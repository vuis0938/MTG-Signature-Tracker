/**
 * Moxfield 格式解析器
 *
 * 解析 Moxfield「Copy for Moxfield」格式的牌表文本。
 * 格式: "1 Sol Ring (CMM) 345"
 * 统一 import-deck 和 add-cards 的解析逻辑，消除重复代码。
 */

import { CardRow } from "@/types";

/**
 * 解析 Moxfield 格式文本
 * @example "1 Sol Ring (CMM) 345" → { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" }
 */
export function parseMoxfieldFormat(text: string): CardRow[] {
  const rows: CardRow[] = [];
  const re = /^(\d+)\s+(.+?)\s+\((\w+)\)\s+(\S+)/i;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 去掉 *F* / *S* 标记
    const cleaned = trimmed.replace(/\s*\*[FS]\*\s*/g, "");
    const m = cleaned.match(re);
    if (!m) continue;
    rows.push({
      count: m[1],
      name: m[2].trim(),
      setCode: m[3],
      collectorNumber: m[4],
    });
  }
  return rows;
}