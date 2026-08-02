import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getDecksWithCards } from "@/lib/data";
import DecksClient from "./decks-client";
import type { CardEntry, Deck, DeckStats } from "@/types";

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
