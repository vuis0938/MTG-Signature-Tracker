import { NextResponse } from "next/server";
import { fetchMountainMageArtists } from "@/lib/mountain-mage";

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
  source: "mtgac" | "mountain_mage";
  status?: "in_progress" | "upcoming" | "unknown";
}

interface GraphqlResponse {
  data?: {
    signingEvent?: RawEvent[];
    artistsByEventIds?: EventArtist[];
  };
}

async function graphql(query: string): Promise<GraphqlResponse> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

export async function GET() {
  const results: EventWithArtists[] = [];

  try {
    // 1. 获取 MTG Artist Connection 活动
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

    // 5. 组装 MTGAC 结果
    for (const e of upcoming) {
      results.push({
        ...e,
        artists: artistMap.get(e.id) || [],
        source: "mtgac",
      });
    }
  } catch (error) {
    console.error("[Events API] MTGAC 获取失败:", error);
    // 不中断，继续尝试 Mountain Mage
  }

  // ─── Mountain Mage 数据（按章节+截止日期分组）─────────────
  try {
    const mmData = await fetchMountainMageArtists();

    if (mmData.success && mmData.sections?.length > 0) {
      for (const section of mmData.sections) {
        if (section.artists.length === 0) continue;

        const today = new Date().toISOString().split("T")[0];
        const label = section.status === "in_progress" ? "进行中" : "即将截止";

        results.push({
          id: `mountain-mage-${section.name.toLowerCase().replace(/[\s.]+/g, "-")}`,
          name: `Mountain Mage · ${section.name}（${label}）`,
          city: "代理平台（邮寄）",
          startDate: today,
          endDate: section.deadline || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          artists: section.artists,
          source: "mountain_mage",
          status: section.status,
        });
      }
    }
  } catch (error) {
    console.error("[Events API] Mountain Mage 获取失败:", error);
  }

  return NextResponse.json({ success: true, events: results });
}