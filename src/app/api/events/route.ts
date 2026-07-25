import { NextResponse } from "next/server";

const GRAPHQL_URL =
  "https://mtgartistconnectionwebservice-production.up.railway.app/graphql";
const UA = "MTG-Signature-Tracker/1.0";

interface RawEvent {
  id: string;
  name: string;
  city: string;
  startDate: string;
  endDate: string;
}

interface EventArtist {
  artistName: string;
  eventId: string;
}

export interface EventWithArtists {
  id: string;
  name: string;
  city: string;
  startDate: string;
  endDate: string;
  artists: string[];
}

async function graphql(query: string): Promise<any> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

export async function GET() {
  try {
    // 1. 获取所有活动
    const eventsData = await graphql(
      "{ signingEvent { id name city startDate endDate } }"
    );
    const events: RawEvent[] = eventsData?.data?.signingEvent || [];

    // 2. 筛选未来活动（含今天之后的）
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const upcoming = events
      .filter((e) => new Date(e.endDate) >= now)
      .sort(
        (a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      );

    // 3. 获取所有活动 ID
    const eventIds = upcoming.map((e) => e.id);

    // 4. 批量获取画家映射
    // 分批查询（每次最多 50 个 eventId）
    const artistMap = new Map<string, string[]>();
    const BATCH = 50;

    for (let i = 0; i < eventIds.length; i += BATCH) {
      const batch = eventIds.slice(i, i + BATCH);
      const idsStr = batch.map((id) => `"${id}"`).join(", ");

      const artistData = await graphql(
        `{ artistsByEventIds(eventIds: [${idsStr}]) { artistName eventId } }`
      );

      const mappings: EventArtist[] =
        artistData?.data?.artistsByEventIds || [];

      for (const m of mappings) {
        const list = artistMap.get(m.eventId) || [];
        list.push(m.artistName);
        artistMap.set(m.eventId, list);
      }
    }

    // 5. 组装结果
    const result: EventWithArtists[] = upcoming.map((e) => ({
      ...e,
      artists: artistMap.get(e.id) || [],
    }));

    return NextResponse.json({ success: true, events: result });
  } catch (error) {
    console.error("[Events API]", error);
    return NextResponse.json(
      { error: "获取活动数据失败" },
      { status: 500 }
    );
  }
}
