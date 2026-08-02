import { NextRequest, NextResponse } from "next/server";
import { fetchMountainMageArtists } from "@/lib/mountain-mage";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";

interface CuratedSection {
  name: string;
  deadline: string | null;
  artists: string[];
}

/** 从 Supabase 读取人工策展数据，不存在则返回 null */
async function loadCurated(): Promise<CuratedSection[] | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("mountain_mage_curated")
      .select("sections")
      .eq("id", "mountain_mage")
      .single();

    if (error || !data?.sections) return null;
    const sections = data.sections as CuratedSection[];
    if (sections.length > 0) return sections;
    return null;
  } catch {
    return null;
  }
}

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
  endDate: string | null;
  artists: string[];
  source: "mtgac" | "mountain_mage";
}

interface GraphqlResponse {
  data?: {
    signingEvent?: RawEvent[];
    artistsByEventIds?: EventArtist[];
  };
}

async function graphql(query: string, variables?: Record<string, unknown>): Promise<GraphqlResponse> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

export async function GET(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

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

      const artistData = await graphql(
        `query($ids: [ID!]!) { artistsByEventIds(eventIds: $ids) { artistName eventId } }`,
        { ids: batch }
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
  // 优先读取人工策展数据，不存在则回退到自动解析
  try {
    const curated = await loadCurated();
    const today = new Date().toISOString().split("T")[0];

    if (curated && curated.length > 0) {
      // 使用人工策展数据
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      let lastDeadline: string | null = null;
      for (const section of curated) {
        if (section.artists.length === 0) continue;
        const effectiveDeadline = section.deadline || lastDeadline;
        if (section.deadline) lastDeadline = section.deadline;
        // 过期过滤：截止日期已过则跳过
        if (effectiveDeadline) {
          const deadlineDate = new Date(effectiveDeadline + "T00:00:00Z");
          if (deadlineDate < now) continue;
        }
        const sortDate = effectiveDeadline || today;
        results.push({
          id: `mountain-mage-${section.name.toLowerCase().replace(/[\s.]+/g, "-")}`,
          name: `Mountain Mage · ${section.name.replace(/\*+/g, "").trim()}`,
          city: "代理平台（邮寄）",
          startDate: sortDate,
          endDate: section.deadline || null,
          artists: section.artists,
          source: "mountain_mage",
        });
      }
    } else {
      // 回退到自动解析
      const mmData = await fetchMountainMageArtists();
      if (mmData.success && mmData.sections?.length > 0) {
        let lastDeadline: string | null = null;
        for (const section of mmData.sections) {
          if (section.artists.length === 0) continue;
          const sortDate = section.deadline || lastDeadline || today;
          if (section.deadline) lastDeadline = section.deadline;
          results.push({
            id: `mountain-mage-${section.name.toLowerCase().replace(/[\s.]+/g, "-")}`,
            name: `Mountain Mage · ${section.name.replace(/\*+/g, "").trim()}`,
            city: "代理平台（邮寄）",
            startDate: sortDate,
            endDate: section.deadline || null,
            artists: section.artists,
            source: "mountain_mage",
          });
        }
      }
    }
  } catch (error) {
    console.error("[Events API] Mountain Mage 获取失败:", error);
  }

  // ─── 统一排序：按时间升序，同日期会场优先于平台 ──────────
  results.sort((a, b) => {
    const dateA = new Date(a.source === "mtgac" ? a.startDate : (a.endDate || a.startDate)).getTime();
    const dateB = new Date(b.source === "mtgac" ? b.startDate : (b.endDate || b.startDate)).getTime();
    if (dateA !== dateB) return dateA - dateB;
    // 同日期：mtgac（会场）优先于 mountain_mage（平台）
    if (a.source === "mtgac" && b.source === "mountain_mage") return -1;
    if (a.source === "mountain_mage" && b.source === "mtgac") return 1;
    return 0;
  });

  return NextResponse.json({ success: true, events: results });
}