import type { Metadata } from "next";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getDecksWithCards } from "@/lib/data";
import { getSupabase } from "@/lib/supabase";
import DecksClient from "./decks-client";
import type { CardEntry, Deck } from "@/types";

export const metadata: Metadata = {
  title: "我的套牌",
  description: "管理您的万智牌套牌，追踪每张卡牌的签绘状态。",
  openGraph: {
    description: "管理您的万智牌套牌，追踪每张卡牌的签绘状态。",
  },
};

export default async function DecksPage() {
  // 服务端预取：从 cookie 获取用户，直接查数据库
  const token = (await cookies()).get("auth_token")?.value;
  const userName = verifyToken(token);

  if (!userName) {
    return <DecksClient fallbackDecks={[]} fallbackStats={{}} fallbackCards={{}} />;
  }

  const { decks, stats, cardsByDeck } = await getDecksWithCards(userName);

  // 补充 updated_at：getDecksWithCards 的 select 未包含此字段，
  // 但套牌列表需要它来显示"上次更新"时间（不修改 data.ts 的 SQL 避免部署兼容性问题）
  if (decks.length > 0) {
    const supabase = getSupabase();
    const deckIds = decks.map((d) => d.id);
    const { data: updatedAts } = await supabase
      .from("decks")
      .select("id, updated_at")
      .in("id", deckIds);

    if (updatedAts) {
      const map = new Map(updatedAts.map((d) => [d.id, d.updated_at]));
      for (const deck of decks) {
        (deck as Deck).updated_at = map.get(deck.id);
      }
    }
  }

  return (
    <DecksClient
      fallbackDecks={decks as Deck[]}
      fallbackStats={stats}
      fallbackCards={cardsByDeck as Record<string, CardEntry[]>}
    />
  );
}