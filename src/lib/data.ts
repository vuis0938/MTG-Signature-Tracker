/**
 * 服务端数据获取模块
 *
 * 供 Server Component 页面直接调用，避免客户端二次 API 请求。
 * 与 API 路由共享相同的查询逻辑，保证数据一致性。
 */

import "server-only";
import { getSupabase } from "@/lib/supabase";
import type { Deck, DeckStats } from "@/types";

/**
 * 获取用户套牌列表（含卡牌统计）
 *
 * 单次查询拉取所有卡牌的 deck_id + status，在内存中聚合统计，
 * 避免 N+1 查询问题。
 */
export async function getDecksWithStats(
  userName: string
): Promise<{ decks: Deck[]; stats: Record<string, DeckStats> }> {
  const supabase = getSupabase();

  const { data: decks, error } = await supabase
    .from("decks")
    .select("*")
    .eq("user_name", userName)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[data] 查询套牌失败:", error.message);
    return { decks: [], stats: {} };
  }

  if (!decks || decks.length === 0) {
    return { decks: [], stats: {} };
  }

  // 单条查询拉取所有卡牌的 deck_id + status，在内存中聚合统计
  const deckIds = decks.map((d) => d.id);
  const { data: allCards } = await supabase
    .from("cards")
    .select("deck_id, status")
    .in("deck_id", deckIds);

  const stats: Record<string, DeckStats> = {};
  for (const deck of decks) {
    stats[deck.id] = { total: 0, unsigned: 0, pending: 0 };
  }
  if (allCards) {
    for (const card of allCards) {
      const s = stats[card.deck_id];
      if (!s) continue;
      s.total++;
      if (card.status === 1) s.pending++;
      else if (card.status === 0 || card.status === 3) s.unsigned++;
    }
  }

  return { decks, stats };
}
