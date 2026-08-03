import { NextRequest, NextResponse } from "next/server";
import { delay, SCRYFALL_UA } from "@/lib/scryfall-client";
import { getUserFromRequest } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import type { Printing } from "@/types";

/** 检查卡牌名称是否精确匹配目标（排除双面卡/裂片卡中仅一面同名的情况） */
function matchesCardName(card: Record<string, unknown>, target: string): boolean {
  return (card.name as string || "") === target;
}

export async function GET(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const cardName = searchParams.get("name");

    if (!cardName?.trim()) {
      return NextResponse.json({ error: "缺少卡牌名称" }, { status: 400 });
    }

    const target = cardName.trim();

    // ── 1. 优先查缓存表 ──────────────────────────────────
    const supabase = getSupabase();
    const { data: cached } = await supabase
      .from("card_printings")
      .select("printings")
      .eq("card_name", target)
      .single();

    if (cached?.printings && Array.isArray(cached.printings) && cached.printings.length > 0) {
      return NextResponse.json({
        success: true,
        cardName: target,
        printings: cached.printings as Printing[],
        count: cached.printings.length,
        cached: true,
      });
    }

    // ── 2. 缓存未命中，查 Scryfall ──────────────────────
    const allPrintings: Printing[] = [];
    let pageUrl = `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(target)}"+unique:prints&order=released`;

    let isFirstPage = true;
    while (pageUrl) {
      // Scryfall 限速：请求间隔 ≥100ms，但首页无需等待
      if (!isFirstPage) await delay(100);
      isFirstPage = false;
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
          image_url: card.image_uris?.normal || card.image_uris?.small || card.card_faces?.[0]?.image_uris?.normal || card.card_faces?.[0]?.image_uris?.small || null,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    }

    // ── 3. 写入缓存表（fire-and-forget） ────────────────
    if (allPrintings.length > 0) {
      const allArtists = [...new Set(allPrintings.map((p) => p.artist))];
      supabase
        .from("card_printings")
        .upsert({
          card_name: target,
          printings: allPrintings as unknown[],
          all_artists: allArtists,
        })
        .then(({ error }) => {
          if (error) {
            console.warn(`[Printings] 缓存写入失败 ${target}:`, error.message);
          }
        });
    }

    return NextResponse.json({
      success: true,
      cardName: target,
      printings: allPrintings,
      count: allPrintings.length,
      cached: false,
    });
  } catch (error) {
    console.error("[Printings]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
