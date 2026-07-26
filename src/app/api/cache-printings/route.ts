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
 * POST /api/cache-printings
 * 接收一组去重卡牌名，从 Scryfall 拉取所有印刷版本并写入 card_printings 表
 * 由导入/添加卡牌流程同步调用，需等待缓存完成才返回
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
          // 先检查是否已有缓存
          const { data: existing } = await supabase
            .from("card_printings")
            .select("card_name")
            .eq("card_name", name)
            .maybeSingle();

          if (existing) {
            return { name, cached: true };
          }

          // 从 Scryfall 拉取
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
        console.warn(`[CachePrintings] ${cardName} HTTP ${res.status}`);
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