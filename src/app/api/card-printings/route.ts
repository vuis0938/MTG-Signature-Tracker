import { NextRequest, NextResponse } from "next/server";

const SCRYFALL_UA = "MTG-Signature-Tracker/1.0";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PrintingInfo {
  set: string;
  set_name: string;
  collector_number: string;
  artist: string;
  image_url: string | null;
  released_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cardName = searchParams.get("name");

    if (!cardName?.trim()) {
      return NextResponse.json({ error: "缺少卡牌名称" }, { status: 400 });
    }

    const allPrintings: PrintingInfo[] = [];
    let pageUrl = `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(cardName.trim())}"+unique:prints&order=released`;

    // 分页获取所有印刷版本
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
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}