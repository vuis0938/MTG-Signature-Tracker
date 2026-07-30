import { NextRequest, NextResponse } from "next/server";
import { delay, SCRYFALL_UA } from "@/lib/scryfall-client";
import type { Printing } from "@/types";

/** 检查卡牌名称是否精确匹配目标（排除双面卡/裂片卡中仅一面同名的情况） */
function matchesCardName(card: Record<string, unknown>, target: string): boolean {
  return (card.name as string || "") === target;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cardName = searchParams.get("name");

    if (!cardName?.trim()) {
      return NextResponse.json({ error: "缺少卡牌名称" }, { status: 400 });
    }

    const target = cardName.trim();
    const allPrintings: Printing[] = [];
    let pageUrl = `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(target)}"+unique:prints&order=released`;

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
        // 过滤双面卡/裂片卡：只有名称精确匹配的才加入
        if (!matchesCardName(card, target)) continue;
        allPrintings.push({
          set: card.set,
          set_name: card.set_name,
          collector_number: card.collector_number,
          artist: card.artist || (card.card_faces?.[0]?.artist) || "Unknown",
          image_url: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    }

    return NextResponse.json({
      success: true,
      cardName: target,
      printings: allPrintings,
      count: allPrintings.length,
    });
  } catch (error) {
    console.error("[Printings]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}