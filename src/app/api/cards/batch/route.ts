import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import type { CardEntry } from "@/types";

// POST: 批量查询多个套牌的所有卡牌（用于活动匹配页面）
export async function POST(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { deckIds } = body as { deckIds?: string[] };

    if (!deckIds || deckIds.length === 0) {
      return NextResponse.json({ error: "缺少套牌 ID" }, { status: 400 });
    }
    if (deckIds.length > 50) {
      return NextResponse.json({ error: "套牌数量过多（最多 50 个）" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证所有套牌属于当前用户
    const { data: ownedDecks } = await supabase
      .from("decks")
      .select("id, name")
      .in("id", deckIds)
      .eq("user_name", userName);

    if (!ownedDecks || ownedDecks.length === 0) {
      return NextResponse.json({ error: "无权访问这些套牌" }, { status: 403 });
    }

    // 构建 deckId -> deckName 映射
    const deckMap = new Map(ownedDecks.map((d) => [d.id, d.name]));
    const validDeckIds = Array.from(deckMap.keys());

    // 查询所有卡牌
    const { data: cards, error } = await supabase
      .from("cards")
      .select("*")
      .in("deck_id", validDeckIds);

    if (error) {
      console.error("[Cards Batch API] 查询失败:", error.message);
      return NextResponse.json({ error: "获取卡牌失败" }, { status: 500 });
    }

    // 为每张卡牌附加 deck_name
    const cardsWithDeckName: CardEntry[] = (cards || []).map((card) => ({
      ...card,
      deck_name: deckMap.get(card.deck_id) || card.deck_id,
    })) as CardEntry[];

    return NextResponse.json({
      success: true,
      cards: cardsWithDeckName,
      count: cardsWithDeckName.length,
    });
  } catch (error) {
    console.error("[Cards Batch API]", error);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}
