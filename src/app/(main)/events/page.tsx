import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getEvents } from "@/lib/events-data";
import EventsClient from "./events-client";
import type { CalendarEvent } from "@/types";

export default async function EventsPage() {
  // 服务端预取活动数据，消除首屏加载
  const token = (await cookies()).get("auth_token")?.value;
  const userName = verifyToken(token);

  if (!userName) {
    return <EventsClient fallbackEvents={[]} />;
  }

  const events = await getEvents();

  return (
    <EventsClient fallbackEvents={events as CalendarEvent[]} />
  );
}
