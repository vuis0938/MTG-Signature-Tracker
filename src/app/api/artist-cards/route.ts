import { NextRequest, NextResponse } from "next/server";
import { delay, SCRYFALL_UA } from "@/lib/scryfall-client";
import type { ArtistCard } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const artist = searchParams.get("artist");

    if (!artist?.trim()) {
      return NextResponse.json({ error: "缺少画家名称" }, { status: 400 });
    }

    const allCards: ArtistCard[] = [];
    let pageUrl = `https://api.scryfall.com/cards/search?q=a:"${encodeURIComponent(artist.trim())}"+unique:prints&order=released`;

    while (pageUrl) {
      await delay(100);
      const res = await fetch(pageUrl, {
        headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
      });

      if (res.status === 404) {
        return NextResponse.json(
          { error: `未找到画家 "${artist}" 的卡牌` },
          { status: 404 }
        );
      }

      if (!res.ok) {
        console.error(`[ArtistCards] HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      for (const card of data.data || []) {
        allCards.push({
          name: card.name,
          set: card.set,
          set_name: card.set_name,
          collector_number: card.collector_number,
          image_url:
            card.image_uris?.normal ||
            card.image_uris?.small ||
            card.card_faces?.[0]?.image_uris?.normal ||
            card.card_faces?.[0]?.image_uris?.small ||
            null,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    }

    return NextResponse.json({
      success: true,
      artist: artist.trim(),
      cards: allCards,
      count: allCards.length,
    });
  } catch (error) {
    console.error("[ArtistCards]", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}