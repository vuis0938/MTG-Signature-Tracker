import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractArtists, extractImageUrl, ScryfallCard, SCRYFALL_UA, SCRYFALL_BASE_URL } from "@/lib/scryfall-client";
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
    if (cardIds.length > 100) {
      return NextResponse.json({ error: "卡牌数量过多（最多 100 张）" }, { status: 400 });
    }
    if (!setCode?.trim() || !collectorNumber?.trim()) {
      return NextResponse.json({ error: "缺少 set_code 或 collector_number" }, { status: 400 });
    }

    // 验证所有卡牌归属权：先查 cards 拿到 deck_id，再查 decks 验证归属
    // 不使用 join（避免外键关系名不一致导致查询报错）
    const { data: cards, error: cardsError } = await supabase
      .from("cards")
      .select("id, deck_id")
      .in("id", cardIds);

    if (cardsError) {
      console.error("[SwitchPrinting] 卡牌查询失败:", cardsError.message, "cardIds:", cardIds);
      return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
    }

    if (!cards || cards.length === 0) {
      console.warn("[SwitchPrinting] 未找到任何卡牌, cardIds:", cardIds);
      return NextResponse.json({ error: "卡牌不存在" }, { status: 404 });
    }

    // 检查是否所有 cardIds 都找到了
    const foundIds = new Set(cards.map((c) => c.id));
    const missingIds = cardIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      console.warn("[SwitchPrinting] 部分卡牌未找到, missing:", missingIds);
      return NextResponse.json({ error: "部分卡牌不存在" }, { status: 404 });
    }

    // 查询所属套牌的 user_name 验证归属权
    const deckIds = [...new Set(cards.map((c) => c.deck_id))];
    const { data: decks, error: decksError } = await supabase
      .from("decks")
      .select("id, user_name")
      .in("id", deckIds);

    if (decksError) {
      console.error("[SwitchPrinting] 套牌查询失败:", decksError.message);
      return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
    }

    const deckOwners = new Map(decks?.map((d) => [d.id, d.user_name]));
    const allOwned = cards.every((c) => deckOwners.get(c.deck_id) === userName);
    if (!allOwned) {
      return NextResponse.json({ error: "无权操作部分卡牌" }, { status: 403 });
    }

    // 从 Scryfall 获取新印刷版本
    const url = `${SCRYFALL_BASE_URL}/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}`;
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