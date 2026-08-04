import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";

// 卡牌状态映射：0=未签, 1=送签中, 2=已签, 3=心动
const STATUS_TEXT: Record<number, string> = {
  0: "未签",
  1: "送签中",
  2: "已签",
  3: "心动",
};

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

    const decksByGroup = new Map<
      string,
      {
        name: string;
        cards: Array<{ name: string; set: string; count: number; artist: string; status: string }>;
        progress: { total: number; signed: number; unsigned: number; pending: number };
      }
    >();

    // 初始化所有套牌（包括空套牌）
    for (const deck of decks || []) {
      decksByGroup.set(deck.id, {
        name: deck.name,
        cards: [],
        progress: { total: 0, signed: 0, unsigned: 0, pending: 0 },
      });
    }

    // 合并相同卡牌（同名+同系列+同画家+同状态）
    const mergeKey = (c: NonNullable<typeof cards>[number]) =>
      `${c.card_name}|${c.set_code}|${(c.artist_names || []).join(",")}|${c.status}`;

    for (const card of cards || []) {
      const deck = decksByGroup.get(card.deck_id);
      if (!deck) continue;

      // 统计签绘进度
      deck.progress.total++;
      if (card.status === 2) deck.progress.signed++;
      else if (card.status === 1) deck.progress.pending++;
      else deck.progress.unsigned++;

      const key = mergeKey(card);
      const existing = deck.cards.find(
        (c) => `${c.name}|${c.set}|${c.artist}|${STATUS_TEXT[card.status]}` === key
      );
      if (existing) {
        existing.count++;
      } else {
        deck.cards.push({
          name: card.card_name,
          set: card.set_code,
          count: 1,
          artist: (card.artist_names || []).join(", "),
          status: STATUS_TEXT[card.status] || "未签",
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
