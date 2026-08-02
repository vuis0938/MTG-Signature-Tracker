import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractArtists, extractImageUrl, ScryfallCard, SCRYFALL_UA } from "@/lib/scryfall-client";
import { getUserFromRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { cardIds, setCode, collectorNumber } = body as {
      cardIds?: string[];
      setCode?: string;
      collectorNumber?: string;
    };

    if (!cardIds || cardIds.length === 0) {
      return NextResponse.json({ error: "缺少卡牌 ID" }, { status: 400 });
    }
    if (!setCode?.trim() || !collectorNumber?.trim()) {
      return NextResponse.json({ error: "缺少 set_code 或 collector_number" }, { status: 400 });
    }

    // 验证所有卡牌归属权：通过 deck_id 关联到 decks 表检查 user_name
    const { data: ownedCards } = await supabase
      .from("cards")
      .select("id, deck:decks!inner(user_name)")
      .in("id", cardIds);

    if (!ownedCards || ownedCards.length !== cardIds.length) {
      return NextResponse.json({ error: "部分卡牌不存在或无权操作" }, { status: 403 });
    }

    const allOwned = ownedCards.every((c) => {
      const owner = c.deck as unknown as { user_name: string } | null;
      return owner?.user_name === userName;
    });
    if (!allOwned) {
      return NextResponse.json({ error: "无权操作部分卡牌" }, { status: 403 });
    }

    // 从 Scryfall 获取新印刷版本
    const url = `https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json(
          { error: `未找到 ${setCode}/${collectorNumber} 对应的卡牌` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Scryfall 查询失败 (HTTP ${res.status})` },
        { status: 502 }
      );
    }

    const scryfallCard = (await res.json()) as ScryfallCard;

    // 批量更新所有同款卡牌
    const updates: Record<string, unknown> = {
      scryfall_id: scryfallCard.id,
      set_name: scryfallCard.set_name,
      set_code: setCode,
      collector_number: collectorNumber,
      artist_names: extractArtists(scryfallCard),
      image_url: extractImageUrl(scryfallCard),
    };

    const { error: updateError } = await supabase
      .from("cards")
      .update(updates)
      .in("id", cardIds);

    if (updateError) {
      console.error("[SwitchPrinting] 数据库更新失败:", updateError.message);
      return NextResponse.json(
        { error: "数据库更新失败" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      cardIds,
      cardName: scryfallCard.name,
      newSet: scryfallCard.set_name,
      newSetCode: setCode,
      newCollectorNumber: collectorNumber,
      newArtistNames: extractArtists(scryfallCard),
      newImageUrl: extractImageUrl(scryfallCard),
    });
  } catch (error) {
    console.error("[SwitchPrinting]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}