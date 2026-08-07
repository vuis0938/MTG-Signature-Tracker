import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAllPrintings, delay } from "@/lib/scryfall-client";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import type { Printing } from "@/types";

interface FuzzyCardResult {
  card_name: string;
  printings: Printing[];
  allArtists: string[];
}

/** 验证单个 printing 对象是否包含所有必需字段 */
function isValidPrinting(p: unknown): p is Printing {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.artist === "string" &&
    typeof obj.set === "string" &&
    typeof obj.set_name === "string" &&
    typeof obj.collector_number === "string" &&
    (obj.image_url === null || typeof obj.image_url === "string") &&
    typeof obj.released_at === "string"
  );
}

/** 清理 printings 数组：过滤无效项并确保字段类型正确 */
function sanitizePrintings(printings: unknown[]): Printing[] {
  const valid: Printing[] = [];
  for (const p of printings) {
    if (!isValidPrinting(p)) {
      console.warn("[FuzzyMatch] 跳过无效 printing 缓存项:", p);
      continue;
    }
    valid.push(p);
  }
  return valid;
}

export async function POST(request: NextRequest) {
  // 鉴权
  const userName = await getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：防止 Scryfall API 滥用
  const ip = getClientIP(request);
  const limit = await rateLimit(`fuzzy-match:${ip}`, 10, 10 * 60 * 1000);
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

    // 验证所有套牌属于当前用户
    const { data: ownedDecks } = await supabase
      .from("decks")
      .select("id")
      .in("id", deckIds)
      .eq("user_name", userName);

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

    // ── 第一步：从缓存表批量读取 ──
    const { data: cachedRows } = await supabase
      .from("card_printings")
      .select("card_name, printings, all_artists")
      .in("card_name", uniqueNames);

    const cachedMap = new Map<string, FuzzyCardResult>();
    if (cachedRows) {
      for (const row of cachedRows) {
        // 防御：历史数据或异常写入可能导致 printings/all_artists 非数组
        const rawPrintings = Array.isArray(row.printings) ? row.printings : [];
        const printings = sanitizePrintings(rawPrintings);
        const allArtists = Array.isArray(row.all_artists)
          ? (row.all_artists as string[]).filter((a): a is string => typeof a === "string")
          : [];
        if (printings.length === 0) continue;
        cachedMap.set(row.card_name, {
          card_name: row.card_name,
          printings,
          allArtists,
        });
      }
    }

    const cachedNames = new Set(cachedMap.keys());
    const missedNames = uniqueNames.filter((n) => !cachedNames.has(n));

    // ── 第二步：缓存未命中的走 Scryfall 实时查询 ──
    const scryfallResults: FuzzyCardResult[] = [];
    if (missedNames.length > 0) {
      const CONCURRENCY = 6;
      for (let i = 0; i < missedNames.length; i += CONCURRENCY) {
        const batch = missedNames.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async (name) => {
            const rawPrintings = await fetchAllPrintings(name);
            const printings = sanitizePrintings(rawPrintings as unknown[]);
            return {
              card_name: name,
              printings,
              allArtists: [...new Set(printings.map((p) => p.artist))],
            };
          })
        );
        scryfallResults.push(...batchResults);
        if (i + CONCURRENCY < missedNames.length) await delay(150);
      }
    }

    // ── 第三步：将从 Scryfall 查到的结果写入缓存 ──
    const rowsToCache = scryfallResults
      .filter((r) => r.printings.length > 0)
      .map((r) => ({
        card_name: r.card_name,
        printings: r.printings,
        all_artists: r.allArtists,
      }));
    if (rowsToCache.length > 0) {
      supabase.from("card_printings").upsert(rowsToCache, { onConflict: "card_name" }).then(
        ({ error }) => {
          if (error) console.warn("[FuzzyMatch] 写缓存失败:", error.message);
        }
      );
    }

    // ── 第四步：合并结果 ──
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