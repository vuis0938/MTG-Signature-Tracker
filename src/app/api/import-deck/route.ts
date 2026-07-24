import { NextRequest, NextResponse } from "next/server";
import { parse as parseCSVPapa } from "papaparse";
import { supabase } from "@/lib/supabase";
import {
  fetchCardBySetAndNumber,
  fetchCardByName,
  extractArtists,
  extractImageUrl,
} from "@/lib/scryfall";

interface CardRow {
  count: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  fuzzy?: boolean; // 是否需要模糊搜索
}

// ─── 格式解析 ─────────────────────────────────────────────

/**
 * 解析 Moxfield 格式：
 *   1 Sol Ring (CMM) 345
 *   1 Arcane Signet (ELD) 314 *F*
 *   1 Lightning Bolt (2X2) 123
 */
function parseMoxfieldFormat(text: string): CardRow[] {
  const rows: CardRow[] = [];
  // 匹配: [数量] 卡名 (系列代码) 编号 [*F*]
  const re = /^(\d+)\s+(.+?)\s+\((\w+)\)\s+(\S+)/i;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const cleaned = trimmed.replace(/\s*\*[FS]\*\s*/g, ""); // 移除 *F* 等标记
    const m = cleaned.match(re);
    if (m) {
      rows.push({
        count: m[1],
        name: m[2].trim(),
        setCode: m[3],
        collectorNumber: m[4],
      });
    }
  }

  return rows;
}

/**
 * 解析格式: 1 Card Name
 * （Arena / MTGO / Plain Text 都用这个）
 */
function parseNameFormat(text: string): CardRow[] {
  const rows: CardRow[] = [];
  const re = /^(\d+)?\s*(.+)$/i;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(re);
    if (m) {
      const name = m[2].trim();
      // 跳过明显的非卡牌行
      if (name.startsWith("//") || name.startsWith("#")) continue;
      if (name.length < 2 || name.length > 100) continue;
      rows.push({
        count: m[1] || "1",
        name,
        setCode: "",
        collectorNumber: "",
        fuzzy: true,
      });
    }
  }

  return rows;
}

/**
 * 自动检测格式并解析
 */
function parseDeckText(text: string): CardRow[] {
  // 先试 Moxfield 格式（含系列代码 + 编号）
  const moxfield = parseMoxfieldFormat(text);
  if (moxfield.length > 0) {
    console.log(`[Import] 检测为 Moxfield 格式，共 ${moxfield.length} 行`);
    return moxfield;
  }

  // 再试 CSV（含 header 行）
  if (text.includes(",") && /count|quantity|edition|set/i.test(text.split("\n")[0])) {
    const rows = parseCSV(text);
    if (rows.length > 0) {
      console.log(`[Import] 检测为 CSV 格式，共 ${rows.length} 行`);
      return rows;
    }
  }

  // 否则当作纯文本牌名清单
  const nameRows = parseNameFormat(text);
  if (nameRows.length > 0) {
    console.log(`[Import] 检测为纯文本牌名格式，共 ${nameRows.length} 行`);
    return nameRows;
  }

  return [];
}

// ─── CSV 解析（保留作为后备） ──────────────────────────────

function parseCSV(csvText: string): CardRow[] {
  const result = parseCSVPapa<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  const headers = result.meta.fields ?? [];
  const countCol = headers.find((h: string) => h.includes("count") || h.includes("quantity")) ?? "";
  const editionCol = headers.find((h: string) => h.includes("edition") || h.includes("set")) ?? "";
  const numberCol = headers.find((h: string) => h.includes("collector") || h.includes("number")) ?? "";
  const nameCol = headers.find((h: string) => h === "name" || h.includes("card")) ?? "";

  if (!editionCol || !numberCol) {
    return [];
  }

  return result.data
    .filter((row: Record<string, string>) => row[numberCol]?.trim() && row[editionCol]?.trim())
    .map((row: Record<string, string>) => ({
      count: (row[countCol] || "1").trim(),
      name: (row[nameCol] || "").trim(),
      setCode: row[editionCol].trim(),
      collectorNumber: row[numberCol].trim(),
    }));
}

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, text } = body as { name?: string; text?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "请输入套牌名称" }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴 Moxfield 导出的牌表内容" }, { status: 400 });
    }

    // ── 1. 解析 ──
    const rows = parseDeckText(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "无法识别格式。请使用 Moxfield 的 Copy for Moxfield 或 Plain Text 格式" },
        { status: 400 }
      );
    }

    // ── 2. 创建套牌 ──
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ name: name.trim(), source: "Moxfield Text" })
      .select("id")
      .single();

    if (deckError || !deck) {
      return NextResponse.json(
        { error: `创建套牌失败: ${deckError?.message}` },
        { status: 500 }
      );
    }

    // ── 3. 逐张查询 Scryfall ──
    const results: Array<{ success: boolean; name: string; error?: string }> = [];
    let successCount = 0;
    let failCount = 0;

    for (const card of rows) {
      const scryfallCard = card.fuzzy
        ? await fetchCardByName(card.name)
        : await fetchCardBySetAndNumber(card.setCode, card.collectorNumber);

      if (!scryfallCard) {
        failCount++;
        results.push({
          success: false,
          name: card.name || `${card.setCode}/${card.collectorNumber}`,
          error: card.fuzzy ? "Scryfall 模糊搜索未找到" : "Scryfall 未找到",
        });
        continue;
      }

      const artists = extractArtists(scryfallCard);
      const imageUrl = extractImageUrl(scryfallCard);

      const { error: insertError } = await supabase.from("cards").insert({
        deck_id: deck.id,
        scryfall_id: scryfallCard.id,
        card_name: scryfallCard.name,
        set_name: scryfallCard.set_name,
        set_code: scryfallCard.set,
        collector_number: scryfallCard.collector_number,
        artist_names: artists,
        image_url: imageUrl,
      });

      if (insertError) {
        failCount++;
        results.push({
          success: false,
          name: scryfallCard.name,
          error: `写入失败: ${insertError.message}`,
        });
      } else {
        successCount++;
        results.push({ success: true, name: scryfallCard.name });
      }
    }

    return NextResponse.json({
      success: true,
      deckId: deck.id,
      total: rows.length,
      successCount,
      failCount,
      format: rows[0]?.fuzzy ? "fuzzy" : "precise",
      results,
    });
  } catch (error) {
    console.error("[Import]", error);
    return NextResponse.json(
      { error: "服务器内部错误，请重试" },
      { status: 500 }
    );
  }
}
