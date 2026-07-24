import { NextRequest, NextResponse } from "next/server";
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
 * 解析 Copy for Moxfield 格式：
 *   1 Sol Ring (CMM) 345
 *   1 Arcane Signet (ELD) 314 *F*
 */
function parseMoxfieldFormat(text: string): CardRow[] {
  const rows: CardRow[] = [];
  // 匹配: [数量] 卡名 (系列代码) 编号 [可选标记]
  const re = /^(\d+)\s+(.+?)\s+\((\w+)\)\s+(\S+)/i;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/\s*\*[FS]\*\s*/g, ""); // 移除 *F* *S* 标记
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, text } = body as { name?: string; text?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "请输入套牌名称" }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴 Copy for Moxfield 的内容" }, { status: 400 });
    }

    // ── 解析 ──
    const rows = parseMoxfieldFormat(text);
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "未识别到有效卡牌。请确认使用的是 Moxfield 的「Copy for Moxfield」格式。\n\n格式示例：\n1 Sol Ring (CMM) 345\n1 Arcane Signet (ELD) 314",
        },
        { status: 400 }
      );
    }

    // ── 创建套牌 ──
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ name: name.trim(), source: "Copy for Moxfield" })
      .select("id")
      .single();

    if (deckError || !deck) {
      return NextResponse.json(
        { error: `创建套牌失败: ${deckError?.message}` },
        { status: 500 }
      );
    }

    // ── 逐张查询 Scryfall ──
    const results: Array<{ success: boolean; name: string; error?: string }> = [];
    let successCount = 0;
    let failCount = 0;

    for (const card of rows) {
      const scryfallCard = await fetchCardBySetAndNumber(card.setCode, card.collectorNumber);

      if (!scryfallCard) {
        failCount++;
        results.push({
          success: false,
          name: card.name || `${card.setCode}/${card.collectorNumber}`,
          error: "Scryfall 未找到",
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
