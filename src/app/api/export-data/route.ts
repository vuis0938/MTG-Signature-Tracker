import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const { data: decks } = await supabase
      .from("decks")
      .select("*")
      .eq("user_name", userName)
      .order("created_at", { ascending: false });

    const { data: cards } = await supabase
      .from("cards")
      .select("*")
      .in("deck_id", (decks || []).map((d) => d.id))
      .order("artist_names");

    // 按套牌分组，输出精简结构
    const deckMap = new Map((decks || []).map((d) => [d.id, d.name]));

    const decksByGroup = new Map<
      string,
      { name: string; cards: Array<{ name: string; set: string; count: number; artist: string }> }
    >();

    // 初始化所有套牌（包括空套牌）
    for (const deck of decks || []) {
      decksByGroup.set(deck.id, { name: deck.name, cards: [] });
    }

    // 合并相同卡牌（同名+同系列+同画家）
    const mergeKey = (c: NonNullable<typeof cards>[number]) =>
      `${c.card_name}|${c.set_code}|${(c.artist_names || []).join(",")}`;

    for (const card of cards || []) {
      const deck = decksByGroup.get(card.deck_id);
      if (!deck) continue;

      const key = mergeKey(card);
      const existing = deck.cards.find((c) => `${c.name}|${c.set}|${c.artist}` === key);
      if (existing) {
        existing.count++;
      } else {
        deck.cards.push({
          name: card.card_name,
          set: card.set_code,
          count: 1,
          artist: (card.artist_names || []).join(", "),
        });
      }
    }

    return NextResponse.json({
      success: true,
      deckCount: decks?.length || 0,
      cardCount: cards?.length || 0,
      decks: Array.from(decksByGroup.values()),
    });
  } catch (error) {
    console.error("[ExportData]", error);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
