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
  source: "mtgac" | "mountain_mage" | "manual";
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

// ─── 数据源 1: MTG Artist Connection ──────────────────────

async function fetchMtgacEvents(): Promise<EventWithArtists[]> {
  const results: EventWithArtists[] = [];

  const eventsData = await graphql(
    "{ signingEvent { id name city startDate endDate } }"
  );
  const events: RawEvent[] = eventsData?.data?.signingEvent || [];

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const upcoming = events
    .filter((e) => new Date(e.endDate) >= now)
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

  const eventIds = upcoming.map((e) => e.id);

  const artistMap = new Map<string, string[]>();
  const BATCH = 50;

  for (let i = 0; i < eventIds.length; i += BATCH) {
    const batch = eventIds.slice(i, i + BATCH);

    const artistData = await graphql(
      `query($ids: [String!]!) { artistsByEventIds(eventIds: $ids) { artistName eventId } }`,
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

  for (const e of upcoming) {
    results.push({
      ...e,
      artists: artistMap.get(e.id) || [],
      source: "mtgac",
    });
  }

  return results;
}

// ─── 数据源 2: Mountain Mage ──────────────────────────────

async function fetchMountainMageEvents(): Promise<EventWithArtists[]> {
  const results: EventWithArtists[] = [];
  const today = new Date().toISOString().split("T")[0];

  const curated = await loadCurated();

  if (curated && curated.length > 0) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let lastDeadline: string | null = null;
    for (const section of curated) {
      if (section.artists.length === 0) continue;
      const effectiveDeadline = section.deadline || lastDeadline;
      if (section.deadline) lastDeadline = section.deadline;
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

  return results;
}

// ─── 数据源 3: 自定义活动 ──────────────────────────────────

async function fetchCustomEvents(): Promise<EventWithArtists[]> {
  const results: EventWithArtists[] = [];
  const supabase = getSupabase();
  const now = new Date().toISOString().split("T")[0];
  const { data: customEvents } = await supabase
    .from("events")
    .select("*")
    .eq("source", "manual")
    .eq("archived", false)
    .gte("date", now)
    .order("date", { ascending: true });

  if (customEvents && customEvents.length > 0) {
    for (const e of customEvents) {
      results.push({
        id: `custom-${e.id}`,
        name: e.name,
        city: e.location || "自定义活动",
        startDate: e.date,
        endDate: e.end_date || null,
        artists: e.artists || [],
        source: "manual" as const,
      });
    }
  }

  return results;
}

// ─── 主 Handler ──────────────────────────────────────────

export async function GET(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 三数据源并行获取（原先串行，总耗时 = 三个数据源之和）
  const [mtgacResult, mmResult, customResult] = await Promise.allSettled([
    fetchMtgacEvents(),
    fetchMountainMageEvents(),
    fetchCustomEvents(),
  ]);

  const results: EventWithArtists[] = [];

  if (mtgacResult.status === "fulfilled") {
    results.push(...mtgacResult.value);
  } else {
    console.error("[Events API] MTGAC 获取失败:", mtgacResult.reason);
  }

  if (mmResult.status === "fulfilled") {
    results.push(...mmResult.value);
  } else {
    console.error("[Events API] Mountain Mage 获取失败:", mmResult.reason);
  }

  if (customResult.status === "fulfilled") {
    results.push(...customResult.value);
  } else {
    console.error("[Events API] 自定义活动获取失败:", customResult.reason);
  }

  // ─── 统一排序：按时间升序 ──────────────────────────────────
  results.sort((a, b) => {
    const dateA = new Date(a.source === "mtgac" ? a.startDate : (a.endDate || a.startDate)).getTime();
    const dateB = new Date(b.source === "mtgac" ? b.startDate : (b.endDate || b.startDate)).getTime();
    if (dateA !== dateB) return dateA - dateB;
    if (a.source === "mtgac" && b.source === "mountain_mage") return -1;
    if (a.source === "mountain_mage" && b.source === "mtgac") return 1;
    return 0;
  });

  return NextResponse.json(
    { success: true, events: results },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" } }
  );
}
