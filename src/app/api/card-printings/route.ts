import { NextRequest, NextResponse } from "next/server";
import { delay, SCRYFALL_UA } from "@/lib/scryfall-client";
import type { Printing } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cardName = searchParams.get("name");

    if (!cardName?.trim()) {
      return NextResponse.json({ error: "缺少卡牌名称" }, { status: 400 });
    }

    const allPrintings: Printing[] = [];
    let pageUrl = `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(cardName.trim())}"+unique:prints&order=released`;

    while (pageUrl) {
      await delay(100);
      const res = await fetch(pageUrl, {
        headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
      });

      if (res.status === 404) {
        return NextResponse.json(
          { error: `未找到卡牌 "${cardName}"` },
          { status: 404 }
        );
      }

      if (!res.ok) {
        console.error(`[Printings] HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      for (const card of data.data || []) {
        allPrintings.push({
          set: card.set,
          set_name: card.set_name,
          collector_number: card.collector_number,
          artist: card.artist || (card.card_faces?.[0]?.artist) || "Unknown",
          image_url: card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || null,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    }

    return NextResponse.json({
      success: true,
      cardName: cardName.trim(),
      printings: allPrintings,
      count: allPrintings.length,
    });
  } catch (error) {
    console.error("[Printings]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}