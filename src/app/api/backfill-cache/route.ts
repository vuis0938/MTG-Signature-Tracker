import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAllPrintings, delay } from "@/lib/scryfall-client";
import type { Printing } from "@/types";

// Vercel Hobby 超时 10s，留 2s 安全余量
const TIME_BUDGET_MS = 8000;

/**
 * POST /api/backfill-cache
 * 一次性补全所有历史套牌的模糊匹配缓存
 */
export async function POST(_request: NextRequest) {
  const startTime = Date.now();
  try {
    const { data: cards } = await supabase
      .from("cards")
      .select("card_name");

    if (!cards || cards.length === 0) {
      return NextResponse.json({ success: true, total: 0, cached: 0, skipped: 0, continue: false });
    }

    const allNames = [...new Set(cards.map((c) => c.card_name))];

    const { data: cached } = await supabase
      .from("card_printings")
      .select("card_name");

    const cachedNames = new Set(cached?.map((r) => r.card_name) || []);
    const missing = allNames.filter((n) => !cachedNames.has(n));

    if (missing.length === 0) {
      return NextResponse.json({
        success: true,
        total: allNames.length,
        cached: 0,
        skipped: allNames.length,
        continue: false,
        message: "所有卡牌已缓存",
      });
    }

    const CONCURRENCY = 4;
    let newCached = 0;
    let failed = 0;
    let continueFlag = false;

    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        continueFlag = true;
        break;
      }

      const batch = missing.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (name) => {
          const printings = await fetchAllPrintings(name);
          if (printings.length === 0) return { name, ok: false };

          const allArtists = [...new Set(printings.map((p) => p.artist))];
          const { error } = await supabase.from("card_printings").upsert(
            {
              card_name: name,
              printings,
              all_artists: allArtists,
            },
            { onConflict: "card_name" }
          );

          return { name, ok: !error };
        })
      );

      for (const r of results) {
        if (r.ok) newCached++;
        else failed++;
      }

      if (i + CONCURRENCY < missing.length && !continueFlag) await delay(200);
    }

    const remaining = missing.length - newCached - failed;

    return NextResponse.json({
      success: true,
      total: allNames.length,
      cached: newCached,
      skipped: allNames.length - missing.length,
      failed,
      continue: continueFlag,
      remaining,
    });
  } catch (error) {
    console.error("[BackfillCache]", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}