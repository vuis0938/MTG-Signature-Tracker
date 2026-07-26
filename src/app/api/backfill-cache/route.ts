import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const SCRYFALL_UA = "MTG-Signature-Tracker/1.0";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Printing {
  artist: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
  released_at: string;
}

/**
 * POST /api/backfill-cache
 * 一次性补全所有历史套牌的模糊匹配缓存
 * 从 cards 表取所有不重复卡牌名，检查哪些未缓存，补全
 */
export async function POST(_request: NextRequest) {
  try {
    // 1. 获取所有不重复卡牌名
    const { data: cards } = await supabase
      .from("cards")
      .select("card_name");

    if (!cards || cards.length === 0) {
      return NextResponse.json({ success: true, total: 0, cached: 0, skipped: 0 });
    }

    const allNames = [...new Set(cards.map((c) => c.card_name))];

    // 2. 获取已缓存的卡牌名
    const { data: cached } = await supabase
      .from("card_printings")
      .select("card_name");

    const cachedNames = new Set(cached?.map((r) => r.card_name) || []);

    // 3. 找出未缓存的
    const missing = allNames.filter((n) => !cachedNames.has(n));

    if (missing.length === 0) {
      return NextResponse.json({
        success: true,
        total: allNames.length,
        cached: 0,
        skipped: allNames.length,
        message: "所有卡牌已缓存",
      });
    }

    // 4. 批量从 Scryfall 拉取并写入缓存
    const CONCURRENCY = 6;
    let newCached = 0;
    let failed = 0;

    for (let i = 0; i < missing.length; i += CONCURRENCY) {
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

      if (i + CONCURRENCY < missing.length) await delay(150);
    }

    return NextResponse.json({
      success: true,
      total: allNames.length,
      cached: newCached,
      skipped: allNames.length - missing.length,
      failed,
    });
  } catch (error) {
    console.error("[BackfillCache]", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

async function fetchAllPrintings(cardName: string): Promise<Printing[]> {
  const printings: Printing[] = [];
  let pageUrl = `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(cardName)}"+unique:prints&order=released`;

  while (pageUrl) {
    await delay(100);
    try {
      const res = await fetch(pageUrl, {
        headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
      });

      if (res.status === 404) break;
      if (!res.ok) {
        console.warn(`[BackfillCache] ${cardName} HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      for (const card of data.data || []) {
        const artist =
          card.artist ||
          card.card_faces?.[0]?.artist ||
          "Unknown";
        const imageUrl =
          card.image_uris?.small ||
          card.card_faces?.[0]?.image_uris?.small ||
          null;

        printings.push({
          artist,
          set: card.set,
          set_name: card.set_name,
          collector_number: card.collector_number,
          image_url: imageUrl,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    } catch {
      break;
    }
  }

  return printings;
}