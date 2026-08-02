import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getDecksWithStats } from "@/lib/data";
import MatchClient from "./match-client";
import type { Deck, DeckStats } from "@/types";

export default async function MatchPage() {
  // 服务端预取套牌数据，消除首屏加载
  const token = (await cookies()).get("auth_token")?.value;
  const userName = verifyToken(token);

  if (!userName) {
    return <MatchClient fallbackDecks={[]} fallbackStats={{}} />;
  }

  const { decks, stats } = await getDecksWithStats(userName);

  return (
    <MatchClient
      fallbackDecks={decks as Deck[]}
      fallbackStats={stats}
    />
  );
}
