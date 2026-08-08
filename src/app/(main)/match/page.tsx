import type { Metadata } from "next";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getDecksWithStats } from "@/lib/data";
import { getEvents } from "@/lib/events-data";
import { SWRFallbackProvider } from "@/components/swr-fallback-provider";
import MatchClient from "./match-client";
import type { Deck, CalendarEvent } from "@/types";

export const metadata: Metadata = {
  title: "画家匹配",
  description: "将您的套牌与即将到来的活动画家进行匹配，快速找到需要签绘的卡牌。",
  openGraph: {
    description: "将您的套牌与即将到来的活动画家进行匹配，快速找到需要签绘的卡牌。",
  },
};

export default async function MatchPage() {
  // 服务端预取套牌 + 活动数据，消除首屏加载
  const token = (await cookies()).get("auth_token")?.value;
  const userName = verifyToken(token);

  if (!userName) {
    return <MatchClient fallbackDecks={[]} fallbackStats={{}} fallbackEvents={[]} />;
  }

  // 两个数据源相互独立，并行预取（events 走 unstable_cache，成本极低）
  const [{ decks, stats }, events] = await Promise.all([
    getDecksWithStats(userName),
    getEvents(),
  ]);

  const typedDecks = decks as Deck[];
  const typedEvents = events as CalendarEvent[];

  // 构建全局缓存 fallback：decks 列表 + 活动
  const fallback: Record<string, unknown> = {
    "/api/decks": { success: true, decks: typedDecks, stats },
    "/api/events": { success: true, events: typedEvents },
  };

  return (
    <SWRFallbackProvider fallback={fallback}>
      <MatchClient
        fallbackDecks={typedDecks}
        fallbackStats={stats}
        fallbackEvents={typedEvents}
      />
    </SWRFallbackProvider>
  );
}
