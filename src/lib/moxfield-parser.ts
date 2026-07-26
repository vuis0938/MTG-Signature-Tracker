/**
 * 套牌列表解析器
 *
 * 支持 Moxfield 四种导出格式的自动检测与解析：
 *   - Copy for Moxfield:  "1 Sol Ring (CMM) 345"
 *   - Copy for Arena:     "Deck\n1 Sol Ring"  (含 About/Commander/Deck/Sideboard 分区头，无系列/编号)
 *   - Copy for MTGO:      "1 Sol Ring"        (无系列/编号)
 *   - Copy Plain Text:    "1 Sol Ring"        (无系列/编号)
 *
 * 统一 import-deck 和 add-cards 的解析逻辑。
 */

import { CardRow, ImportFormat } from "@/types";

// ─── 正则 ──────────────────────────────────────────────────

/** Moxfield：有系列和编号 */
const RE_FULL = /^(\d+)\s+(.+?)\s+\((\w+)\)\s+(\S+)/i;

/** Arena / MTGO / Plain Text：仅有数量 + 卡名 */
const RE_SIMPLE = /^(\d+)\s+(.+)$/;

// ─── 检测 ──────────────────────────────────────────────────

/**
 * 自动检测导入格式
 * 通过抽样前几行判断属于哪种格式
 */
export function detectFormat(text: string): ImportFormat {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "moxfield";

  // 检查是否有 Arena 特有分区头（About / Commander / Deck / Sideboard / Companion）
  const hasArenaHeader = lines.some(
    (l) => /^(About|Deck|Sideboard|Companion|Commander)$/i.test(l)
  );
  if (hasArenaHeader) return "arena";

  // 抽样检查：有 (SET) NUMBER 的就是 Moxfield 格式
  let fullCount = 0;
  let simpleCount = 0;
  const sampleSize = Math.min(lines.length, 10);
  for (let i = 0; i < sampleSize; i++) {
    const cleaned = stripTags(lines[i]);
    if (RE_FULL.test(cleaned)) fullCount++;
    else if (RE_SIMPLE.test(cleaned)) simpleCount++;
  }
  return fullCount >= simpleCount ? "moxfield" : "mtgo";
}

// ─── 工具 ──────────────────────────────────────────────────

/** 去除 *F* / *S* / #tag 标记 */
function stripTags(line: string): string {
  return line.replace(/\s*\*[FS]\*/g, "").replace(/\s*#\S.*$/, "").trim();
}

/** 判断是否为 Arena 分区头行（About 区、Commander、Deck、Sideboard、Companion） */
function isHeaderLine(line: string): boolean {
  return /^(About|Deck|Sideboard|Companion|Commander)$/i.test(line.trim());
}

// ─── 解析 ──────────────────────────────────────────────────

/**
 * 解析 Moxfield 格式文本（兼容四种导出格式）
 *
 * @example "1 Sol Ring (CMM) 345" → { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" }
 * @example "3 Birds of Paradise" → { count: "3", name: "Birds of Paradise" }
 */
export function parseMoxfieldFormat(text: string): CardRow[] {
  const rows: CardRow[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isHeaderLine(trimmed)) continue;

    const cleaned = stripTags(trimmed);

    // 尝试完整格式：COUNT NAME (SET) NUMBER
    const fullMatch = cleaned.match(RE_FULL);
    if (fullMatch) {
      rows.push({
        count: fullMatch[1],
        name: fullMatch[2].trim(),
        setCode: fullMatch[3],
        collectorNumber: fullMatch[4],
      });
      continue;
    }

    // 尝试简单格式：COUNT NAME
    const simpleMatch = cleaned.match(RE_SIMPLE);
    if (simpleMatch) {
      rows.push({
        count: simpleMatch[1],
        name: simpleMatch[2].trim(),
      });
    }
  }
  return rows;
}