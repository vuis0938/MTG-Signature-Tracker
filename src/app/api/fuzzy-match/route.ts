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
        cardMap: {},
        cardCount: 0,
      });
    }

    const uniqueNames = [...new Set(cards.map((c) => c.card_name))];

    // ── 第一步：从缓存表批量读取 ──
    const { data: cachedRows } = await supabase
      .from("card_printings")
      .select("card_name, printings, all_artists")
      .in("card_name", uniqueNames);

    const cachedMap = new Map<string, FuzzyCardResult>();
    if (cachedRows) {
      for (const row of cachedRows) {
        cachedMap.set(row.card_name, {
          card_name: row.card_name,
          printings: row.printings as FuzzyPrinting[],
          allArtists: row.all_artists as string[],
        });
      }
    }

    const cachedNames = new Set(cachedMap.keys());
    const missedNames = uniqueNames.filter((n) => !cachedNames.has(n));

    // ── 第二步：缓存未命中的走 Scryfall 实时查询 ──
    let scryfallResults: FuzzyCardResult[] = [];
    if (missedNames.length > 0) {
      const CONCURRENCY = 6;
      for (let i = 0; i < missedNames.length; i += CONCURRENCY) {
        const batch = missedNames.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map((name) => fetchAllPrintings(name))
        );
        scryfallResults.push(...batchResults);
        if (i + CONCURRENCY < missedNames.length) await delay(150);
      }
    }

    // ── 第三步：合并结果（缓存优先） ──
    const cardMap: Record<string, FuzzyCardResult> = {};
    for (const r of cachedMap.values()) {
      cardMap[r.card_name] = r;
    }
    for (const r of scryfallResults) {
      cardMap[r.card_name] = r;
    }

    const totalPrintings = Object.values(cardMap).reduce(
      (s, r) => s + r.printings.length,
      0
    );

    return NextResponse.json({
      success: true,
      cardMap,
      cardCount: uniqueNames.length,
      totalPrintings,
      cacheHit: cachedMap.size,
      cacheMiss: missedNames.length,
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