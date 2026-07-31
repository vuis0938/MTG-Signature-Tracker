import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractArtists, extractImageUrl } from "@/lib/scryfall";
import { batchSearch, CardIdentifier, RateLimiter } from "@/lib/scryfall-client";
import { parseMoxfieldFormat } from "@/lib/moxfield-parser";

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  const t0 = Date.now();

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

    // ── 统一批量查询 Scryfall ──
    // 所有格式统一使用 /cards/collection 批量接口
    const SOFT_DEADLINE_MS = 180 * 1000;
    const totalCards = rows.reduce((sum, r) => sum + (parseInt(r.count, 10) || 1), 0);

    const identifiers: CardIdentifier[] = rows.map((r) => ({
      name: r.name,
      set: r.setCode || undefined,
      collector_number: r.collectorNumber || undefined,
    }));

    const scryfallResults = await batchSearch(identifiers, new RateLimiter(1));

    // 组装结果
    const cardResults = rows.map((card, i) => ({
      card,
      data: scryfallResults[i],
      timedOut: Date.now() - t0 > SOFT_DEADLINE_MS,
    }));

    let successCount = 0;
    let failCount = 0;
    const failedCards: Array<{ name: string; setCode?: string; collectorNumber?: string }> = [];
    const timedOutCards: Array<{ name: string; setCode?: string; collectorNumber?: string }> = [];
    const cardsToInsert: Array<Record<string, unknown>> = [];

    for (const { card, data, timedOut } of cardResults) {
      if (timedOut) {
        const count = parseInt(card.count, 10) || 1;
        failCount += count;
        timedOutCards.push({
          name: card.name,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        });
        continue;
      }

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
        fetch(`${request.nextUrl.origin}/api/cache-printings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardNames: uniqueCardNames }),
        }).catch(() => {});
      } catch {}
    }

    const isTimedOut = timedOutCards.length > 0;
    return NextResponse.json({
      success: true,
      deckId,
      total: totalCards,
      successCount,
      failCount,
      failedCards: failedCards.length > 0 ? failedCards : undefined,
      timedOut: isTimedOut,
      timedOutCards: isTimedOut ? timedOutCards : undefined,
      hint: isTimedOut
        ? `超时保护：${timedOutCards.length} 张卡牌未处理，已添加的 ${successCount} 张已保存。请将剩余卡牌重新添加`
        : undefined,
    });
  } catch (error) {
    console.error("[AddCards]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}