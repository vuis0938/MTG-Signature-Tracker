import type { Metadata } from "next";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getDecksWithCards } from "@/lib/data";
import { getCardsKey } from "@/lib/swr-keys";
import { SWRFallbackProvider } from "@/components/swr-fallback-provider";
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

  const typedDecks = decks as Deck[];
  const typedCards = cardsByDeck as Record<string, CardEntry[]>;

  // 构建全局缓存 fallback：decks 列表 + 每个套牌的卡牌
  const fallback: Record<string, unknown> = {
    "/api/decks": { success: true, decks: typedDecks, stats },
  };
  for (const deck of typedDecks) {
    fallback[getCardsKey(deck.id)] = {
      success: true,
      cards: typedCards[deck.id] || [],
    };
  }

  return (
    <SWRFallbackProvider fallback={fallback}>
      <DecksClient
        fallbackDecks={typedDecks}
        fallbackStats={stats}
        fallbackCards={typedCards}
      />
    </SWRFallbackProvider>
  );
}
