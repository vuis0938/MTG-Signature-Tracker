import type { Metadata } from "next";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getEvents } from "@/lib/events-data";
import { SWRFallbackProvider } from "@/components/swr-fallback-provider";
import EventsClient from "./events-client";
import type { CalendarEvent } from "@/types";

export const metadata: Metadata = {
  title: "活动信息",
  description: "查看即将到来的万智牌签绘活动、出席画家及相关信息。",
  openGraph: {
    description: "查看即将到来的万智牌签绘活动、出席画家及相关信息。",
  },
};

export default async function EventsPage() {
  // 服务端预取活动数据，消除首屏加载
  const token = (await cookies()).get("auth_token")?.value;
  const userName = verifyToken(token);

  if (!userName) {
    return <EventsClient fallbackEvents={[]} />;
  }

  let events: CalendarEvent[] = [];
  try {
    events = (await getEvents()) as CalendarEvent[];
  } catch {
    // 所有数据源均失败时不缓存空结果，SWR 客户端会重新尝试
  }

  const fallback: Record<string, unknown> = {
    "/api/events": { success: true, events },
  };

  return (
    <SWRFallbackProvider fallback={fallback}>
      <EventsClient fallbackEvents={events} />
    </SWRFallbackProvider>
  );
}
