import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const SCRYFALL_UA = "MTG-Signature-Tracker/1.0";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FuzzyPrinting {
  artist: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
  released_at: string;
}

interface FuzzyCardResult {
  card_name: string;
  printings: FuzzyPrinting[];
  allArtists: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { deckIds } = body as { deckIds?: string[] };

    if (!deckIds || deckIds.length === 0) {
      return NextResponse.json({ error: "缺少套牌 ID" }, { status: 400 });
    }

    // 获取选中套牌的所有卡牌，取唯一卡牌名
    const { data: cards } = await supabase
      .from("cards")
      .select("card_name, deck_id")
      .in("deck_id", deckIds);

    if (!cards || cards.length === 0) {
      return NextResponse.json({
        success: true,
        cardResults: [],
        cardCount: 0,
      });
    }

    // 去重卡牌名
    const uniqueNames = [...new Set(cards.map((c) => c.card_name))];

    // 并发查询 Scryfall（每批 6 个，避免限速）
    const CONCURRENCY = 6;
    const results: FuzzyCardResult[] = [];

    for (let i = 0; i < uniqueNames.length; i += CONCURRENCY) {
      const batch = uniqueNames.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((name) => fetchAllPrintings(name))
      );
      results.push(...batchResults);
      if (i + CONCURRENCY < uniqueNames.length) await delay(150);
    }

    // 构建 card_name → FuzzyCardResult 映射
    const cardMap: Record<string, FuzzyCardResult> = {};
    for (const r of results) {
      cardMap[r.card_name] = r;
    }

    return NextResponse.json({
      success: true,
      cardMap,
      cardCount: uniqueNames.length,
      totalPrintings: results.reduce((s, r) => s + r.printings.length, 0),
    });
  } catch (error) {
    console.error("[FuzzyMatch]", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

async function fetchAllPrintings(cardName: string): Promise<FuzzyCardResult> {
  const printings: FuzzyPrinting[] = [];
  const artistSet = new Set<string>();
  let pageUrl = `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(cardName)}"+unique:prints&order=released`;

  while (pageUrl) {
    await delay(100);
    try {
      const res = await fetch(pageUrl, {
        headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
      });

      if (res.status === 404) break;
      if (!res.ok) {
        console.warn(`[FuzzyMatch] ${cardName} HTTP ${res.status}`);
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
        artistSet.add(artist);
      }

      pageUrl = data.has_more ? data.next_page : null;
    } catch {
      break;
    }
  }

  return {
    card_name: cardName,
    printings,
    allArtists: Array.from(artistSet),
  };
}