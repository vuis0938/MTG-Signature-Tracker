import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchCardArtists, RateLimiter, fetchScryfallBulkDataVersion, shouldForceRefresh, CACHE_SCHEMA_VERSION, shouldInvalidateCacheSchema } from "@/lib/scryfall-client";
import { warmCardPrintingsCache } from "@/lib/cache-printings";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import type { Printing } from "@/types";

interface FuzzyCardResult {
  card_name: string;
  printings: Printing[];
  allArtists: string[];
}

// 版本号检查节流：1 小时内不重复查 Scryfall
const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 小时

export async function POST(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：防止 Scryfall API 滥用
  const ip = getClientIP(request);
  const limit = rateLimit(`fuzzy-match:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { deckIds } = body as { deckIds?: string[] };

    if (!deckIds || deckIds.length === 0) {
      return NextResponse.json({ error: "缺少套牌 ID" }, { status: 400 });
    }
    if (deckIds.length > 50) {
      return NextResponse.json({ error: "套牌数量过多（最多 50 个）" }, { status: 400 });
    }

    // 验证所有套牌属于当前用户 + 检查 Scryfall 版本号（并行，互不依赖）
    const [deckResult, metaResult] = await Promise.all([
      supabase
        .from("decks")
        .select("id")
        .in("id", deckIds)
        .eq("user_name", userName),
      supabase
        .from("scryfall_meta")
        .select("value, updated_at")
        .eq("key", "bulk_data_version")
        .single(),
    ]);

    const { data: ownedDecks } = deckResult;
    const { data: metaRows } = metaResult;

    if (!ownedDecks || ownedDecks.length === 0) {
      return NextResponse.json({ error: "无权访问这些套牌" }, { status: 403 });
    }

    // 只查询属于当前用户的套牌
    const validDeckIds = ownedDecks.map((d) => d.id);

    const { data: cards } = await supabase
      .from("cards")
      .select("card_name, deck_id")
      .in("deck_id", validDeckIds);

    if (!cards || cards.length === 0) {
      return NextResponse.json({
        success: true,
        cardMap: {},
        cardCount: 0,
      });
    }

    const uniqueNames = [...new Set(cards.map((c) => c.card_name))];

    // ── 检查缓存格式版本 + Scryfall 数据版本，判断缓存是否可靠 ──
    let forceRefresh = false;
    const storedVersion: string | null = metaRows?.value?.updated_at ?? null;
    const storedSchemaVersion: number | null | undefined = metaRows?.value?.schema_version;
    const lastChecked = metaRows?.updated_at ? new Date(metaRows.updated_at).getTime() : 0;
    const shouldCheckVersion = Date.now() - lastChecked > VERSION_CHECK_INTERVAL_MS;

    let currentVersion: string | null = storedVersion;
    let needMetaUpdate = false;

    // 1. 缓存格式版本变了 → 清空旧格式缓存（改查询/字段后自动失效，无需手动 DELETE）
    if (shouldInvalidateCacheSchema(storedSchemaVersion, CACHE_SCHEMA_VERSION)) {
      await supabase.from("card_printings").delete().not("id", "is", null);
      forceRefresh = true;
      needMetaUpdate = true;
      console.log(
        `[FuzzyMatch] 缓存格式版本变化 ${storedSchemaVersion ?? 0} → ${CACHE_SCHEMA_VERSION}，已清空缓存`
      );
    }

    // 2. Scryfall 数据版本检查（1 小时节流）
    if (shouldCheckVersion) {
      currentVersion = await fetchScryfallBulkDataVersion();
      if (shouldForceRefresh(storedVersion, currentVersion)) {
        // 数据版本号变了 → 缓存可能过期，需要刷新
        forceRefresh = true;
        console.log(`[FuzzyMatch] Scryfall 数据版本变化: ${storedVersion} → ${currentVersion}`);
      }
      needMetaUpdate = true;
    }

    // 3. 合并更新 meta（数据版本 + 缓存格式版本）
    if (needMetaUpdate) {
      supabase
        .from("scryfall_meta")
        .upsert(
          {
            key: "bulk_data_version",
            value: {
              updated_at: currentVersion ?? storedVersion,
              schema_version: CACHE_SCHEMA_VERSION,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        )
        .then(({ error }) => {
          if (error) console.warn("[FuzzyMatch] 更新版本号失败:", error.message);
        });
    }

    // ── 第一步：预热/刷新缓存 ──
    if (forceRefresh) {
      // 版本或格式变了，强制刷新本次查询涉及的所有卡牌
      await warmCardPrintingsCache(uniqueNames, { forceRefresh: true });
    }

    // ── 第二步：从缓存表批量读取 ──
    const { data: cachedRows } = await supabase
      .from("card_printings")
      .select("card_name, printings, all_artists")
      .in("card_name", uniqueNames);

    const cachedMap = new Map<string, FuzzyCardResult>();
    if (cachedRows) {
      for (const row of cachedRows) {
        cachedMap.set(row.card_name, {
          card_name: row.card_name,
          printings: row.printings as Printing[],
          allArtists: row.all_artists as string[],
        });
      }
    }

    const cachedNames = new Set(cachedMap.keys());
    const missedNames = uniqueNames.filter((n) => !cachedNames.has(n));

    // ── 第三步：缓存未命中的走 Scryfall 轻量查询（仅首页，只取画家名）──
    // Phase 1 策略：不翻页、不拉取完整印刷版本，只取首页画家名列表。
    // 100 张卡从 10-20 秒降到 2-3 秒。完整印刷版本由客户端 Phase 2 按需加载。
    const scryfallResults: FuzzyCardResult[] = [];
    if (missedNames.length > 0) {
      const CONCURRENCY = 6;
      const rateLimiter = new RateLimiter(10);
      for (let i = 0; i < missedNames.length; i += CONCURRENCY) {
        const batch = missedNames.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async (name) => {
            const { artists } = await fetchCardArtists(name, rateLimiter);
            return {
              card_name: name,
              printings: [], // Phase 1 不返回印刷版本，客户端 Phase 2 按需加载
              allArtists: artists,
            };
          })
        );
        scryfallResults.push(...batchResults);
      }
    }

    // ── 第四步：写入缓存（仅当有完整印刷版本时，Phase 1 不写缓存）──
    // Phase 1 的数据不完整（printings 为空），不写入缓存。
    // 完整印刷版本由客户端调用 /api/cache-printings 后台加载后写入。

    // ── 第五步：合并结果 ──
    const cardMap: Record<string, FuzzyCardResult> = {};
    for (const r of cachedMap.values()) {
      cardMap[r.card_name] = r;
    }
    for (const r of scryfallResults) {
      cardMap[r.card_name] = r;
    }

    const totalPrintings = Object.values(cardMap).reduce(
      (s, r) => s + r.printings.length,
      0
    );

    return NextResponse.json({
      success: true,
      cardMap,
      cardCount: uniqueNames.length,
      totalPrintings,
      cacheHit: cachedMap.size,
      cacheMiss: missedNames.length,
    });
  } catch (error) {
    console.error("[FuzzyMatch]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}