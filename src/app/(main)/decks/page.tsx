import type { Metadata } from "next";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getDecksWithCards } from "@/lib/data";
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

  return (
    <DecksClient
      fallbackDecks={decks as Deck[]}
      fallbackStats={stats}
      fallbackCards={cardsByDeck as Record<string, CardEntry[]>}
    />
  );
}
