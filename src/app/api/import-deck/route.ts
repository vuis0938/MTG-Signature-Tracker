import { NextRequest, NextResponse } from "next/server";
import { parse } from "papaparse";
import { supabase } from "@/lib/supabase";
import {
  fetchCardBySetAndNumber,
  extractArtists,
  extractImageUrl,
} from "@/lib/scryfall";

interface CardRow {
  count: string;
  name: string;
  setCode: string;
  collectorNumber: string;
}

/**
 * 解析 Moxfield CSV，自动检测列名
 */
function parseMoxfieldCSV(csvText: string): CardRow[] {
  const result = parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (result.errors.length > 0) {
    console.warn("[CSV] 解析警告:", result.errors);
  }

  // 查找相关列名（支持 Moxfield 的各种导出格式）
  const headers = result.meta.fields ?? [];
  const countCol = headers.find((h) => h.includes("count") || h.includes("quantity")) ?? "";
  const editionCol = headers.find((h) => h.includes("edition") || h.includes("set")) ?? "";
  const numberCol = headers.find((h) => h.includes("collector") || h.includes("number")) ?? "";
  const nameCol = headers.find((h) => h === "name" || h.includes("card")) ?? "";

  if (!editionCol || !numberCol) {
    throw new Error(
      `CSV 格式不匹配。找不到系列代码(Edition)和编号(Collector Number)列。\n找到的列: ${headers.join(", ")}`
    );
  }

  return result.data
    .filter((row) => {
      const num = row[numberCol]?.trim();
      const set = row[editionCol]?.trim();
      return num && set; // 必须有编号和系列
    })
    .map((row) => ({
      count: (row[countCol] || "1").trim(),
      name: (row[nameCol] || "").trim(),
      setCode: row[editionCol].trim(),
      collectorNumber: row[numberCol].trim(),
    }));
}

/**
 * 去重：同一 Set Code + Collector Number 只查一次
 */
function dedupeCards(rows: CardRow[]): CardRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.setCode}|${row.collectorNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, csv } = body as { name: string; csv: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "请输入套牌名称" }, { status: 400 });
    }
    if (!csv?.trim()) {
      return NextResponse.json({ error: "请粘贴 Moxfield CSV 数据" }, { status: 400 });
    }

    // 1. 解析 CSV
    let rows: CardRow[];
    try {
      rows = parseMoxfieldCSV(csv);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "CSV 解析失败" },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV 中没有找到有效卡牌数据" }, { status: 400 });
    }

    // 2. 去重
    const uniqueCards = dedupeCards(rows);
    console.log(`[Import] 共 ${rows.length} 行，去重后 ${uniqueCards.length} 张独特卡牌`);

    // 3. 创建套牌记录
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ name: name.trim(), source: "Moxfield CSV" })
      .select("id")
      .single();

    if (deckError || !deck) {
      return NextResponse.json(
        { error: `创建套牌失败: ${deckError?.message}` },
        { status: 500 }
      );
    }

    // 4. 逐张查询 Scryfall
    const results: Array<{ success: boolean; name: string; error?: string }> = [];
    let successCount = 0;
    let failCount = 0;

    for (const card of uniqueCards) {
      const scryfallCard = await fetchCardBySetAndNumber(
        card.setCode,
        card.collectorNumber
      );

      if (!scryfallCard) {
        failCount++;
        results.push({
          success: false,
          name: card.name || `${card.setCode}/${card.collectorNumber}`,
          error: "Scryfall 未找到此卡",
        });
        continue;
      }

      // 提取数据
      const artists = extractArtists(scryfallCard);
      const imageUrl = extractImageUrl(scryfallCard);

      // 写入 Supabase
      const { error: insertError } = await supabase.from("cards").insert({
        deck_id: deck.id,
        scryfall_id: scryfallCard.id,
        card_name: scryfallCard.name,
        set_name: scryfallCard.set_name,
        set_code: card.setCode,
        collector_number: card.collectorNumber,
        artist_names: artists,
        image_url: imageUrl,
      });

      if (insertError) {
        failCount++;
        results.push({
          success: false,
          name: scryfallCard.name,
          error: `数据库写入失败: ${insertError.message}`,
        });
      } else {
        successCount++;
        results.push({ success: true, name: scryfallCard.name });
      }
    }

    return NextResponse.json({
      success: true,
      deckId: deck.id,
      total: uniqueCards.length,
      successCount,
      failCount,
      results,
    });
  } catch (error) {
    console.error("[Import] 未预期错误:", error);
    return NextResponse.json(
      { error: "服务器内部错误，请重试" },
      { status: 500 }
    );
  }
}
