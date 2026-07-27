import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  extractArtists,
  extractImageUrl,
} from "@/lib/scryfall";
import type { ScryfallCard } from "@/lib/scryfall";
import { quickFetchCard, searchCardByName, RateLimiter } from "@/lib/scryfall-client";
import { parseMoxfieldFormat, detectFormat } from "@/lib/moxfield-parser";

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  const t0 = Date.now();

  try {
    const body = await request.json();
    const { name, text } = body as { name?: string; text?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "请输入套牌名称" }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴套牌列表内容" }, { status: 400 });
    }

    // ── 解析 ──
    const detectedFormat = detectFormat(text);
    const rows = parseMoxfieldFormat(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "未识别到有效卡牌。支持 Moxfield 的 Copy for Moxfield / Arena / MTGO / Plain Text 格式" },
        { status: 400 }
      );
    }

    const formatLabels: Record<string, string> = {
      moxfield: "Copy for Moxfield",
      arena: "Copy for Arena",
      mtgo: "Copy for MTGO",
      plain: "Copy Plain Text",
      generic: "通用格式",
    };

    // ── 创建套牌 ──
    const userName = request.cookies.get("user_name")?.value || "默认用户";
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ name: name.trim(), source: formatLabels[detectedFormat] || "Copy for Moxfield", user_name: userName })
      .select("id")
      .single();

    if (deckError || !deck) {
      return NextResponse.json({ error: `创建套牌失败: ${deckError?.message}` }, { status: 500 });
    }

    // ── 全并发查询 Scryfall（平滑限速 9/s，exact 优先，180s 软截止）──
    // 所有卡牌同时发出请求，每张独立等待令牌，互不阻塞
    // exact 端点限速宽松（~10+/s），fuzzy 降级时 429 pause 兜底
    const RATE = 9;
    const rateLimiter = new RateLimiter(RATE);
    const SOFT_DEADLINE_MS = 180 * 1000; // 180s 软截止，Vercel Hobby 默认 300s 兜底
    const tScryfall = Date.now();
    const totalCards = rows.reduce((sum, r) => sum + (parseInt(r.count, 10) || 1), 0);

    const cardResults = await Promise.all(
      rows.map(async (card) => {
        // 获取令牌前先检查软截止
        if (Date.now() - t0 > SOFT_DEADLINE_MS) {
          return { card, data: null as ScryfallCard | null, timedOut: true };
        }
        await rateLimiter.acquire();
        // 等待令牌期间可能已超时，再检查一次
        if (Date.now() - t0 > SOFT_DEADLINE_MS) {
          return { card, data: null as ScryfallCard | null, timedOut: true };
        }
        const data = card.setCode
          ? await quickFetchCard(card.setCode, card.collectorNumber!, rateLimiter)
          : await searchCardByName(card.name, rateLimiter);
        return { card, data, timedOut: false };
      })
    );

    const tScryfallDone = Date.now();

    // ── 批量写入 Supabase ──
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
          deck_id: deck.id,
          scryfall_id: data.id,
          card_name: data.name,
          set_name: data.set_name,
          set_code: data.set,
          collector_number: data.collector_number,
          artist_names: extractArtists(data),
          image_url: extractImageUrl(data),
        });
      }
      successCount += count;
    }

    const tBeforeDB = Date.now();
    if (cardsToInsert.length > 0) {
      const { error: batchError } = await supabase.from("cards").insert(cardsToInsert);
      if (batchError) {
        console.warn("[Import] 批量写入失败，降级:", batchError.message);
        for (const c of cardsToInsert) {
          await supabase.from("cards").insert(c);
        }
      }
    }
    const tDB = Date.now() - tBeforeDB;
    const tTotal = ((Date.now() - t0) / 1000).toFixed(1);
    const tS = ((tScryfallDone - tScryfall) / 1000).toFixed(1);

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
      deckId: deck.id,
      total: totalCards,
      successCount,
      failCount,
      failedCards: failedCards.length > 0 ? failedCards : undefined,
      timedOut: isTimedOut,
      timedOutCards: isTimedOut ? timedOutCards : undefined,
      hint: isTimedOut
        ? `⏱️ 超时保护：${timedOutCards.length} 张卡牌未处理，已导入的 ${successCount} 张已保存。请将剩余卡牌通过「添加卡牌」重新导入。`
        : undefined,
      timing: {
        total: `${tTotal}s`,
        scryfall: `${tS}s (${totalCards} cards @ ${RATE}/s)`,
        db: `${(tDB / 1000).toFixed(1)}s`,
      },
    });
  } catch (error) {
    console.error("[Import]", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}