import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { logAdminAction } from "@/lib/admin";
import {
  SCRYFALL_BASE_URL,
  SCRYFALL_UA,
  RateLimiter,
  extractArtists,
  fetchArtistCards,
  type ScryfallCard,
} from "@/lib/scryfall-client";
import { warmCardPrintingsCache } from "@/lib/cache-printings";

// ─── 增量补全（每日 cron）────────────────────────────────────
// 拉取 Scryfall 自上次检查以来新发布的画作（released>=since + unique:art），
// 交叉比对缓存键，只刷新受影响（被重印 / 出新画）的缓存条目。
// 纯增量：不清空、不碰用户读路径、用户零延迟。

const CROSS_REFERENCE_BATCH = 100; // .in() 分块，避免 PostgREST URL 超长
const LOOKBACK_DAYS_ON_ADVANCE = 1; // 成功后回看 1 天，容忍当日数据晚到

/** 读取上次增量检查的 since 日期（无记录则默认 30 天前） */
async function readLastSince(): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("scryfall_meta")
    .select("value")
    .eq("key", "last_delta_check")
    .single();
  const since = (data?.value as { since?: string } | null)?.since;
  if (since) return since;
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

/** 拉取 released>=since 的全部新画作（unique:art 按画作去重，与全站一致） */
async function fetchReleasedSince(since: string): Promise<ScryfallCard[]> {
  const results: ScryfallCard[] = [];
  const q = `released>=${since} unique:art`;
  let pageUrl: string | null = `${SCRYFALL_BASE_URL}/cards/search?q=${encodeURIComponent(
    q
  )}&order=released`;

  while (pageUrl) {
    const res: Response = await fetch(pageUrl, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Scryfall 增量查询 HTTP ${res.status}`);
    }
    const data: {
      data?: ScryfallCard[];
      has_more?: boolean;
      next_page?: string | null;
    } = await res.json();
    for (const card of data.data || []) {
      results.push(card);
    }
    pageUrl = data.has_more ? (data.next_page ?? null) : null;
  }
  return results;
}

/** 分块 .in() 查询，返回缓存里受影响的键（卡名或画家名） */
async function queryAffectedKeys(
  table: "card_printings" | "artist_cards",
  column: "card_name" | "artist_name",
  keys: string[],
): Promise<string[]> {
  const supabase = getSupabase();
  const result = new Set<string>();
  for (let i = 0; i < keys.length; i += CROSS_REFERENCE_BATCH) {
    const batch = keys.slice(i, i + CROSS_REFERENCE_BATCH);
    const { data } = await supabase.from(table).select(column).in(column, batch);
    if (data) {
      for (const row of data as Array<Record<string, string>>) {
        result.add(row[column]);
      }
    }
  }
  return [...result];
}

/** 成功推进 since（回看 1 天）+ 记录检查时间 */
async function advanceSince(): Promise<void> {
  const supabase = getSupabase();
  const since = new Date(
    Date.now() - LOOKBACK_DAYS_ON_ADVANCE * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .split("T")[0];
  await supabase.from("scryfall_meta").upsert(
    {
      key: "last_delta_check",
      value: { since, checked_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
}

export async function GET(request: NextRequest) {
  // Vercel cron 会以 Authorization: Bearer ${CRON_SECRET} 调用
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const since = await readLastSince();
    const newCards = await fetchReleasedSince(since);

    // 提取增量里的卡名与画家名（extractArtists 处理双面牌 card_faces）
    const newNames = new Set<string>();
    const newArtists = new Set<string>();
    for (const card of newCards) {
      if (card.name) newNames.add(card.name);
      for (const artist of extractArtists(card)) {
        if (artist && artist !== "Unknown Artist") newArtists.add(artist);
      }
    }

    let refreshedCards = 0;
    let refreshedArtists = 0;

    if (newCards.length > 0) {
      // 卡片：已缓存的卡被重印（新画）→ 强制重抓该卡全部画作
      const affectedCards = await queryAffectedKeys(
        "card_printings",
        "card_name",
        [...newNames]
      );
      if (affectedCards.length > 0) {
        const result = await warmCardPrintingsCache(affectedCards, {
          forceRefresh: true,
        });
        refreshedCards = result.cached;
      }

      // 画家：已缓存的画家出新画 → 重抓该画家全部卡
      const affectedArtists = await queryAffectedKeys(
        "artist_cards",
        "artist_name",
        [...newArtists]
      );
      if (affectedArtists.length > 0) {
        const supabase = getSupabase();
        const rateLimiter = new RateLimiter(10);
        for (const artist of affectedArtists) {
          const { cards, complete } = await fetchArtistCards(artist, rateLimiter);
          if (!complete || cards.length === 0) continue; // 残缺不覆盖
          const { error } = await supabase
            .from("artist_cards")
            .upsert(
              { artist_name: artist, cards, card_count: cards.length },
              { onConflict: "artist_name" }
            );
          if (!error) refreshedArtists++;
        }
      }
    }

    await advanceSince();

    return NextResponse.json({
      success: true,
      newCards: newCards.length,
      refreshedCards,
      refreshedArtists,
    });
  } catch (error) {
    console.error("[CronRefreshCardCache]", error);
    await logAdminAction("system", "cron_refresh_fail", undefined, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "refresh failed" }, { status: 500 });
  }
}
