/**
 * 通用套牌列表解析器
 *
 * 自动识别并解析主流 MTG 套牌文本格式，涵盖：
 *   - Copy for Moxfield:  "1 Sol Ring (CMM) 345"
 *   - Copy for Arena:     "Deck\n1 Sol Ring"  (含 About/Commander/Deck/Sideboard 分区头)
 *   - Copy for MTGO:      "1 Sol Ring"
 *   - Copy Plain Text:    "1 Sol Ring"
 *   - 4x 格式:            "4x Lightning Bolt" 或 "4 x Lightning Bolt"
 *   - 括号 SET-only:      "4 Lightning Bolt (MM2)"   (无收集编号)
 *   - 方括号格式:         "4 [ZNR:45] Glasspool Mimic"
 *   - 斜杠格式:           "4 Lightning Bolt / MM2"
 *   - Cockatrice:         "SB: 1 Card Name"
 *   - 双斜杠注释:         "// comment"
 *   - 井号注释:           "# comment"
 *   - 分类头:             "Creatures (20):", "//Lands", "Spells", etc.
 *   - 通用头:             "DECK:", "MAINDECK:", "SIDEBOARD:", "MAYBEBOARD:"
 *
 * 统一 import-deck 和 add-cards 的解析逻辑。
 */

import { CardRow, ImportFormat } from "@/types";

// ─── 正则 ──────────────────────────────────────────────────

/** 完整格式：COUNT NAME (SET) NUMBER */
const RE_FULL = /^(\d+)\s+(.+?)\s+\((\w+)\)\s+(\S+)$/i;

/** 4x 格式：COUNT x NAME 或 COUNT x NAME */
const RE_X = /^(\d+)\s*x\s+(.+)$/i;

/** 括号 SET-only：COUNT NAME (SET) — 无收集编号 */
const RE_SET_ONLY = /^(\d+)\s+(.+?)\s+\((\w+)\)$/i;

/** 方括号格式：COUNT [SET:NUMBER] NAME */
const RE_BRACKET = /^(\d+)\s+\[(\w+):(\S+)\]\s+(.+)$/i;

/** 斜杠格式：COUNT NAME / SET */
const RE_SLASH = /^(\d+)\s+(.+?)\s*\/\s*(\w+)$/i;

/** Cockatrice 备牌：SB: COUNT NAME */
const RE_SB = /^SB:\s+(\d+)\s+(.+)$/i;

/** 简单格式：COUNT NAME */
const RE_SIMPLE = /^(\d+)\s+(.+)$/;

// ─── 检测 ──────────────────────────────────────────────────

/** 所有需要跳过的节头关键词 */
const SECTION_HEADERS = [
  "About", "Commander", "Companion", "Deck", "Sideboard",
  "Mainboard", "Maindeck", "Maybeboard", "Main", "DECK",
  "MAINDECK", "SIDEBOARD", "MAYBEBOARD",
  "Creature", "Creatures", "Sorcery", "Sorceries",
  "Instant", "Instants", "Enchantment", "Enchantments",
  "Artifact", "Artifacts", "Planeswalker", "Planeswalkers",
  "Land", "Lands", "Spell", "Spells", "Battle", "Battles",
];

/**
 * 自动检测导入格式
 */
export function detectFormat(text: string): ImportFormat {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "moxfield";

  // Arena 特有分区头
  const hasArenaHeader = lines.some(
    (l) => /^(About|Commander|Companion)$/i.test(l)
  );
  if (hasArenaHeader) return "arena";

  // Cockatrice 格式
  const hasSB = lines.some((l) => /^SB:/i.test(l));
  if (hasSB) return "generic";

  // 抽样：有 (SET) NUMBER 就是 moxfield
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

/** 判断是否为节头行（含分类头如 "Creatures (20):"） */
function isHeaderLine(line: string): boolean {
  const trimmed = line.trim();

  // 双斜杠注释行
  if (/^\/\//.test(trimmed)) return true;

  // 井号注释行（但 #tag 在行尾才处理，独占一行的是注释）
  if (/^#/.test(trimmed) && !/^\d/.test(trimmed)) return true;

  // 精确匹配节头
  for (const h of SECTION_HEADERS) {
    if (trimmed.toLowerCase() === h.toLowerCase()) return true;
  }

  // 分类头：Creatures (20): / Lands (24) / //Lands 等
  // 匹配 "Creatures (20):" 或 "//Lands" 或 "Lands (24)"
  if (/^\/\/?\s*(Creatures?|Sorcer(y|ies)|Instants?|Enchantments?|Artifacts?|Planeswalkers?|Lands?|Spells?|Battles?)\s*(\(\d+\))?\s*:?$/i.test(trimmed)) return true;

  // 匹配 "DECK:" / "MAINDECK:" / "SIDEBOARD:" 格式
  if (/^(DECK|MAINDECK|SIDEBOARD|MAYBEBOARD|MAIN):\s*$/i.test(trimmed)) return true;

  return false;
}

// ─── 解析 ──────────────────────────────────────────────────

/**
 * 解析通用 MTG 套牌列表文本
 *
 * 按优先级尝试多种格式，一旦匹配即停止：
 *   1. 完整格式:  1 Sol Ring (CMM) 345
 *   2. 4x 格式:   4x Lightning Bolt
 *   3. 方括号:    4 [ZNR:45] Glasspool Mimic
 *   4. 括号 SET:  4 Lightning Bolt (MM2)
 *   5. 斜杠:      4 Lightning Bolt / MM2
 *   6. Cockatrice: SB: 1 Card Name
 *   7. 简单格式:  4 Lightning Bolt
 */
export function parseMoxfieldFormat(text: string): CardRow[] {
  const rows: CardRow[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 跳过注释和节头
    if (isHeaderLine(trimmed)) continue;

    const cleaned = stripTags(trimmed);

    // 1. 完整格式：COUNT NAME (SET) NUMBER
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

    // 2. 4x 格式：COUNTx NAME
    const xMatch = cleaned.match(RE_X);
    if (xMatch) {
      rows.push({
        count: xMatch[1],
        name: xMatch[2].trim(),
      });
      continue;
    }

    // 3. 方括号格式：COUNT [SET:NUMBER] NAME
    const bracketMatch = cleaned.match(RE_BRACKET);
    if (bracketMatch) {
      rows.push({
        count: bracketMatch[1],
        name: bracketMatch[4].trim(),
        setCode: bracketMatch[2],
        collectorNumber: bracketMatch[3],
      });
      continue;
    }

    // 4. 括号 SET-only：COUNT NAME (SET) — 必须在 FULL 之后
    const setOnlyMatch = cleaned.match(RE_SET_ONLY);
    if (setOnlyMatch) {
      rows.push({
        count: setOnlyMatch[1],
        name: setOnlyMatch[2].trim(),
        setCode: setOnlyMatch[3],
      });
      continue;
    }

    // 5. 斜杠格式：COUNT NAME / SET
    const slashMatch = cleaned.match(RE_SLASH);
    if (slashMatch) {
      rows.push({
        count: slashMatch[1],
        name: slashMatch[2].trim(),
        setCode: slashMatch[3],
      });
      continue;
    }

    // 6. Cockatrice 备牌
    const sbMatch = cleaned.match(RE_SB);
    if (sbMatch) {
      rows.push({
        count: sbMatch[1],
        name: sbMatch[2].trim(),
      });
      continue;
    }

    // 7. 简单格式：COUNT NAME
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