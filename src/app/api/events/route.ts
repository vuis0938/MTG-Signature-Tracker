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

  // ─── Mountain Mage 数据 ──────────────────────────────────
  try {
    const mmData = await fetchMountainMageArtists();

    if (mmData.success && mmData.artists?.length > 0) {
        // 按状态分组
        const inProgress = mmData.artists.filter(
          (a: { status: string }) => a.status === "in_progress"
        );
        const upcoming = mmData.artists.filter(
          (a: { status: string }) => a.status === "upcoming"
        );

        // 进行中的签名作为一个事件
        if (inProgress.length > 0) {
          results.push({
            id: "mountain-mage-in-progress",
            name: "Mountain Mage — 签名进行中",
            city: "代理平台（邮寄）",
            startDate: new Date().toISOString().split("T")[0],
            endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
            artists: inProgress.map((a: { name: string }) => a.name),
            source: "mountain_mage",
            status: "in_progress",
          });
        }

        // 即将开始的签名
        if (upcoming.length > 0) {
          results.push({
            id: "mountain-mage-upcoming",
            name: "Mountain Mage — 即将开始",
            city: "代理平台（邮寄）",
            startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
            endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
            artists: upcoming.map((a: { name: string }) => a.name),
            source: "mountain_mage",
            status: "upcoming",
          });
        }

        // 未知状态的单独列出
        const unknown = mmData.artists.filter(
          (a: { status: string }) => a.status === "unknown"
        );
        if (unknown.length > 0) {
          results.push({
            id: "mountain-mage-unknown",
            name: "Mountain Mage — 其他艺术家",
            city: "代理平台（邮寄）",
            startDate: new Date().toISOString().split("T")[0],
            endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
            artists: unknown.map((a: { name: string }) => a.name),
            source: "mountain_mage",
            status: "unknown",
          });
        }
      }
  } catch (error) {
    console.error("[Events API] Mountain Mage 获取失败:", error);
  }

  return NextResponse.json({ success: true, events: results });
}