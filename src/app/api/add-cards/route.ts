import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractArtists, extractImageUrl, ScryfallCard } from "@/lib/scryfall";
import { quickFetchCard, searchCardByName, delay } from "@/lib/scryfall-client";
import { parseMoxfieldFormat } from "@/lib/moxfield-parser";
import type { CardRow } from "@/types";

// ─── API Handler ──────────────────────────────────────────

export const maxDuration = 30; // 延长 Vercel 超时至 30 秒（Pro 计划）

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { deckId, text } = body as { deckId?: string; text?: string };

    if (!deckId?.trim()) {
      return NextResponse.json({ error: "缺少套牌 ID" }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴套牌列表内容" }, { status: 400 });
    }

    // 验证套牌存在
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .select("id")
      .eq("id", deckId)
      .single();

    if (deckError || !deck) {
      return NextResponse.json({ error: "套牌不存在" }, { status: 404 });
    }

    // 解析
    const rows = parseMoxfieldFormat(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "未识别到有效卡牌。支持 Moxfield 的 Copy for Moxfield / Arena / MTGO / Plain Text 格式" },
        { status: 400 }
      );
    }

    // 并行查询 Scryfall（含时间保护）
    const CONCURRENCY = 5;
    const BATCH_DELAY = 500;
    const TIME_LIMIT_MS = 8_500;
    const cardResults: Array<{ card: CardRow; data: ScryfallCard | null }> = [];
    const tScryfall = Date.now();
    let timedOut = false;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (Date.now() - tScryfall > TIME_LIMIT_MS) {
        timedOut = true;
        for (let j = i; j < rows.length; j++) {
          cardResults.push({ card: rows[j], data: null });
        }
        console.warn(`[AddCards] 时间保护触发：已处理 ${i}/${rows.length}，剩余 ${rows.length - i} 张跳过`);
        break;
      }

      const batch = rows.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (card) => ({
          card,
          data: card.setCode
            ? await quickFetchCard(card.setCode, card.collectorNumber!)
            : await searchCardByName(card.name),
        }))
      );
      cardResults.push(...batchResults);
      if (i + CONCURRENCY < rows.length) await delay(BATCH_DELAY);
    }

    // 批量写入
    let successCount = 0;
    let failCount = 0;
    const failedCards: Array<{ name: string; setCode?: string; collectorNumber?: string }> = [];
    const cardsToInsert: Array<Record<string, unknown>> = [];

    for (const { card, data } of cardResults) {
      if (!data) {
        failCount += parseInt(card.count, 10) || 1;
        failedCards.push({
          name: card.name,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        });
        continue;
      }

      const count = parseInt(card.count, 10) || 1;
      for (let i = 0; i < count; i++) {
        cardsToInsert.push({
          deck_id: deckId,
          scryfall_id: data.id,
          card_name: data.name,
          set_name: data.set_name,
          set_code: data.set,
          collector_number: data.collector_number,
          artist_names: extractArtists(data),
          image_url: extractImageUrl(data),
          status: 0,
          is_signed: false,
        });
      }
      successCount += count;
    }

    if (cardsToInsert.length > 0) {
      const { error: batchError } = await supabase.from("cards").insert(cardsToInsert);
      if (batchError) {
        for (const c of cardsToInsert) {
          await supabase.from("cards").insert(c);
        }
      }
    }

    // ── 同步填充模糊匹配缓存 ──
    const uniqueCardNames = [...new Set(cardsToInsert.map((c) => c.card_name as string))];
    if (uniqueCardNames.length > 0) {
      try {
        await fetch(`${request.nextUrl.origin}/api/cache-printings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardNames: uniqueCardNames }),
        });
      } catch {}
    }

    return NextResponse.json({
      success: true,
      deckId,
      total: rows.length,
      successCount,
      failCount,
      failedCards,
      timedOut,
    });
  } catch (error) {
    console.error("[AddCards]", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}