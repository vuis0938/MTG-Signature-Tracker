import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  ScryfallCard,
  extractArtists,
  extractImageUrl,
} from "@/lib/scryfall";
import { quickFetchCard, searchCardByName, RateLimiter } from "@/lib/scryfall-client";
import { parseMoxfieldFormat, detectFormat } from "@/lib/moxfield-parser";
import type { CardRow } from "@/types";

// ─── API Handler ──────────────────────────────────────────

export const maxDuration = 30; // 延长 Vercel 超时至 30 秒（Pro 计划）

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

    // ── 令牌桶限速并发查询 Scryfall ──
    // 令牌桶保证严格 ≤9 req/s，不触发限速；同时所有请求并发发出，零浪费等待
    const RATE = 9; // 9 req/s（Scryfall 要求 <10，留 1 余量）
    const TIME_LIMIT_MS = 9_000; // 9 秒硬上限（Hobby 10s，留 1s 给 DB）
    const rateLimiter = new RateLimiter(RATE);
    const tScryfall = Date.now();
    let timedOut = false;

    // 全部请求并发发出，令牌桶自动排队调速
    const cardResults = await Promise.all(
      rows.map(async (card, index) => {
        // 时间保护：如果已超时，跳过剩余
        if (Date.now() - tScryfall > TIME_LIMIT_MS) {
          timedOut = true;
          return { card, data: null };
        }
        await rateLimiter.acquire();
        const data = card.setCode
          ? await quickFetchCard(card.setCode, card.collectorNumber!)
          : await searchCardByName(card.name);
        return { card, data };
      })
    );

    if (timedOut) {
      console.warn(`[Import] 时间保护触发：${cardResults.filter((r) => !r.data).length} 张因超时跳过`);
    }

    const tScryfallDone = Date.now();

    // ── 批量写入 Supabase ──
    const results: Array<{ success: boolean; name: string; error?: string }> = [];
    const failedCards: Array<{ name: string; setCode?: string; collectorNumber?: string }> = [];
    let successCount = 0;
    let failCount = 0;
    const cardsToInsert: Array<Record<string, unknown>> = [];

    for (const { card, data } of cardResults) {
      if (!data) {
        failCount += parseInt(card.count, 10) || 1;
        failedCards.push({
          name: card.name,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        });
        results.push({ success: false, name: card.name, error: "未找到" });
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
      results.push({ success: true, name: data.name });
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
    const tCacheStart = Date.now();
    const uniqueCardNames = [...new Set(cardsToInsert.map((c) => c.card_name as string))];
    let cacheCount = 0;
    if (uniqueCardNames.length > 0) {
      try {
        const cacheRes = await fetch(`${request.nextUrl.origin}/api/cache-printings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardNames: uniqueCardNames }),
        });
        const cacheData = await cacheRes.json();
        cacheCount = cacheData.cached || 0;
      } catch {}
    }

    return NextResponse.json({
      success: true,
      deckId: deck.id,
      total: rows.length,
      successCount,
      failCount,
      failedCards,
      timedOut,
      timing: {
        total: `${tTotal}s`,
        scryfall: `${tS}s (${rows.length} cards @ ${RATE}/s)`,
        db: `${(tDB / 1000).toFixed(1)}s`,
        cache: `${((Date.now() - tCacheStart) / 1000).toFixed(1)}s (${cacheCount} cached)`,
      },
      results,
    });
  } catch (error) {
    console.error("[Import]", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}