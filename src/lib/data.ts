/**
 * 服务端数据获取模块
 *
 * 供 Server Component 页面直接调用，避免客户端二次 API 请求。
 * 与 API 路由共享相同的查询逻辑，保证数据一致性。
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import type { Deck, DeckStats, CardEntry } from "@/types";

/** 卡牌渲染所需列（与 CardEntry 类型一一对应，避免 SELECT * 拉取冗余字段） */
const CARD_SELECT_COLUMNS =
  "id, deck_id, card_name, set_code, collector_number, artist_names, image_url, status, is_signed, event_name, event_date";

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
    .select("id, name, source, created_at")
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
    stats[deck.id] = { total: 0, unsigned: 0, pending: 0, heart: 0 };
  }
  if (allCards) {
    for (const card of allCards) {
      const s = stats[card.deck_id];
      if (!s) continue;
      s.total++;
      if (card.status === 1) s.pending++;
      else if (card.status === 2) {
        /* 已签：不计入待签/心动/送签中，由 total 反推 */
      }
      else if (card.status === 3) {
        // 心动：既计入待签（业务上仍是待签目标），也单独统计 heart
        // 这样 deckStats 在心动状态变化时一定会变化，触发套牌页缓存失效
        s.unsigned++;
        s.heart++;
      }
      else s.unsigned++;
    }
  }

  return { decks, stats };
}

/**
 * 获取用户套牌列表 + 所有卡牌（完整数据）
 *
 * 供 Server Component 预取使用，一次拉取所有数据传入客户端，
 * 消除首屏加载和展开套牌时的加载等待。
 * 套牌统计从完整卡牌数据中聚合，无需额外查询。
 */
export async function getDecksWithCards(
  userName: string
): Promise<{
  decks: Deck[];
  stats: Record<string, DeckStats>;
  cardsByDeck: Record<string, CardEntry[]>;
}> {
  const supabase = getSupabase();

  const { data: decks, error } = await supabase
    .from("decks")
    .select("id, name, source, created_at, updated_at")
    .eq("user_name", userName)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[data] 查询套牌失败:", error.message);
    return { decks: [], stats: {}, cardsByDeck: {} };
  }

  if (!decks || decks.length === 0) {
    return { decks: [], stats: {}, cardsByDeck: {} };
  }

  // 单条查询拉取所有卡牌（只选渲染所需列，减少网络负载）
  const deckIds = decks.map((d) => d.id);
  const { data: allCards } = await supabase
    .from("cards")
    .select(CARD_SELECT_COLUMNS)
    .in("deck_id", deckIds)
    .order("artist_names");

  // 按套牌分组 + 聚合统计
  const stats: Record<string, DeckStats> = {};
  const cardsByDeck: Record<string, CardEntry[]> = {};
  for (const deck of decks) {
    stats[deck.id] = { total: 0, unsigned: 0, pending: 0, heart: 0 };
    cardsByDeck[deck.id] = [];
  }
  if (allCards) {
    for (const card of allCards) {
      const s = stats[card.deck_id];
      const list = cardsByDeck[card.deck_id];
      if (s) {
        s.total++;
        if (card.status === 1) s.pending++;
        else if (card.status === 2) {
          /* 已签：不计入待签/心动/送签中，由 total 反推 */
        }
        else if (card.status === 3) {
          // 心动：既计入待签（业务上仍是待签目标），也单独统计 heart
          s.unsigned++;
          s.heart++;
        }
        else s.unsigned++;
      }
      if (list) list.push(card as CardEntry);
    }
  }

  return { decks, stats, cardsByDeck };
}

// ─── 公告 ──────────────────────────────────────────────────

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: string;
  created_at: string;
}

/**
 * 获取当前生效的公告（带服务端缓存）
 *
 * 公告变更频率极低，缓存 5 分钟减少 DB 查询。
 * 供 Server Component 预取，消除公告横幅的布局抖动。
 */
async function _getAnnouncements(): Promise<Announcement[]> {
  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, content, type, created_at")
      .eq("active", true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[data] 查询公告失败:", error.message);
      return [];
    }

    return data || [];
  } catch {
    return [];
  }
}

export const getAnnouncements = unstable_cache(
  _getAnnouncements,
  ["announcements"],
  { revalidate: 300 }
);
