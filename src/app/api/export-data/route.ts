import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

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

  // 限流：导出操作较重，限制 5 次/分钟
  const ip = getClientIP(request);
  const limit = rateLimit(`export-data:${ip}`, 5, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
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
        cards: Array<{ name: string; set: string; cn: string; count: number; artist: string; status: string; event_name?: string | null; event_date?: string | null }>;
        progress: { total: number; signed: number; unsigned: number; pending: number; heart: number };
      }
    >();

    // 初始化所有套牌（包括空套牌）
    for (const deck of decks || []) {
      decksByGroup.set(deck.id, {
        name: deck.name,
        cards: [],
        progress: { total: 0, signed: 0, unsigned: 0, pending: 0, heart: 0 },
      });
    }

    // 合并相同卡牌（同名+同系列+同编号+同画家+同状态）
    // 使用 Map 避免 find() 字符串比较格式不一致导致合并失败
    const mergeKey = (c: NonNullable<typeof cards>[number]) =>
      `${c.card_name}|${c.set_code}|${c.collector_number}|${(c.artist_names || []).join(",")}|${c.status}`;

    // 每个套牌维护一个 key→index 的映射，O(1) 查找而非 O(n) find
    const deckMergeMaps = new Map<string, Map<string, number>>();

    for (const card of cards || []) {
      const deck = decksByGroup.get(card.deck_id);
      if (!deck) continue;

      // 统计签绘进度
      deck.progress.total++;
      if (card.status === 2) deck.progress.signed++;
      else if (card.status === 1) deck.progress.pending++;
      else if (card.status === 3) deck.progress.heart++;
      else deck.progress.unsigned++;

      const key = mergeKey(card);
      let mergeMap = deckMergeMaps.get(card.deck_id);
      if (!mergeMap) {
        mergeMap = new Map();
        deckMergeMaps.set(card.deck_id, mergeMap);
      }

      const existingIdx = mergeMap.get(key);
      if (existingIdx !== undefined) {
        deck.cards[existingIdx].count++;
      } else {
        deck.cards.push({
          name: card.card_name,
          set: card.set_code,
          cn: card.collector_number,
          count: 1,
          artist: (card.artist_names || []).join(", "),
          status: STATUS_TEXT[card.status] || "未签",
          event_name: card.event_name || null,
          event_date: card.event_date || null,
        });
        mergeMap.set(key, deck.cards.length - 1);
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
