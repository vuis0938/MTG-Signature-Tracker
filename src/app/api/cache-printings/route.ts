import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAllPrintings, delay } from "@/lib/scryfall-client";

/**
 * POST /api/cache-printings
 * 接收一组去重卡牌名，从 Scryfall 拉取所有印刷版本并写入 card_printings 表
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cardNames } = body as { cardNames?: string[] };

    if (!cardNames || cardNames.length === 0) {
      return NextResponse.json({ success: true, cached: 0 });
    }

    const uniqueNames = [...new Set(cardNames)];
    const cached: string[] = [];
    const failed: string[] = [];

    const CONCURRENCY = 6;

    for (let i = 0; i < uniqueNames.length; i += CONCURRENCY) {
      const batch = uniqueNames.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (name) => {
          const { data: existing } = await supabase
            .from("card_printings")
            .select("card_name")
            .eq("card_name", name)
            .maybeSingle();

          if (existing) {
            return { name, cached: true };
          }

          const printings = await fetchAllPrintings(name);
          if (printings.length === 0) {
            return { name, cached: false, failed: true };
          }

          const allArtists = [...new Set(printings.map((p) => p.artist))];

          const { error } = await supabase.from("card_printings").insert({
            card_name: name,
            printings,
            all_artists: allArtists,
          });

          if (error) {
            console.warn(`[CachePrintings] 写入失败 ${name}:`, error.message);
            return { name, cached: false, failed: true };
          }

          return { name, cached: true };
        })
      );

      for (const r of results) {
        if (r.cached) cached.push(r.name);
        else if (r.failed) failed.push(r.name);
      }

      if (i + CONCURRENCY < uniqueNames.length) await delay(150);
    }

    return NextResponse.json({
      success: true,
      cached: cached.length,
      failed: failed.length,
      total: uniqueNames.length,
    });
  } catch (error) {
    console.error("[CachePrintings]", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}