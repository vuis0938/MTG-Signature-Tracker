import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const SCRYFALL_UA = "MTG-Signature-Tracker/1.0";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Vercel Hobby 超时 10s，留 2s 安全余量
const TIME_BUDGET_MS = 8000;

interface Printing {
  artist: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
  released_at: string;
}

/**
 * POST /api/backfill-cache
 * 一次性补全所有历史套牌的模糊匹配缓存
 * 有超时保护：如果接近 Vercel 函数超时，返回已完成的进度
 * 前端收到 continue=true 时自动重试，直到全部完成
 */
export async function POST(_request: NextRequest) {
  const startTime = Date.now();
  try {
    // 1. 获取所有不重复卡牌名
    const { data: cards } = await supabase
      .from("cards")
      .select("card_name");

    if (!cards || cards.length === 0) {
      return NextResponse.json({ success: true, total: 0, cached: 0, skipped: 0, continue: false });
    }

    const allNames = [...new Set(cards.map((c) => c.card_name))];

    // 2. 获取已缓存的卡牌名
    const { data: cached } = await supabase
      .from("card_printings")
      .select("card_name");

    const cachedNames = new Set(cached?.map((r) => r.card_name) || []);

    // 3. 找出未缓存的
    const missing = allNames.filter((n) => !cachedNames.has(n));

    if (missing.length === 0) {
      return NextResponse.json({
        success: true,
        total: allNames.length,
        cached: 0,
        skipped: allNames.length,
        continue: false,
        message: "所有卡牌已缓存",
      });
    }

    // 4. 分批处理，带超时保护
    const CONCURRENCY = 4; // 降低并发，减少 Scryfall 限速风险
    let newCached = 0;
    let failed = 0;
    let continueFlag = false;

    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      // 超时检查：如果快超时了，停止并返回 continue=true
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        continueFlag = true;
        break;
      }

      const batch = missing.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (name) => {
          const printings = await fetchAllPrintings(name);
          if (printings.length === 0) return { name, ok: false };

          const allArtists = [...new Set(printings.map((p) => p.artist))];
          const { error } = await supabase.from("card_printings").upsert(
            {
              card_name: name,
              printings,
              all_artists: allArtists,
            },
            { onConflict: "card_name" }
          );

          return { name, ok: !error };
        })
      );

      for (const r of results) {
        if (r.ok) newCached++;
        else failed++;
      }

      if (i + CONCURRENCY < missing.length && !continueFlag) await delay(200);
    }

    const remaining = missing.length - newCached - failed;

    return NextResponse.json({
      success: true,
      total: allNames.length,
      cached: newCached,
      skipped: allNames.length - missing.length,
      failed,
      continue: continueFlag,
      remaining,
    });
  } catch (error) {
    console.error("[BackfillCache]", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

async function fetchAllPrintings(cardName: string, attempt = 0): Promise<Printing[]> {
  const printings: Printing[] = [];
  let pageUrl = `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(cardName)}"+unique:prints&order=released`;

  while (pageUrl) {
    await delay(100);
    try {
      const res = await fetch(pageUrl, {
        headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
      });

      if (res.status === 404) break;

      // 429 限速 → 重试（最多 2 次）
      if (res.status === 429 && attempt < 2) {
        const wait = Math.min(2000 * (attempt + 1), 4000);
        console.warn(`[BackfillCache] ${cardName} 429, ${wait}ms 后重试 (${attempt + 1}/2)`);
        await delay(wait);
        return fetchAllPrintings(cardName, attempt + 1);
      }

      if (!res.ok) {
        console.warn(`[BackfillCache] ${cardName} HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      for (const card of data.data || []) {
        const artist =
          card.artist ||
          card.card_faces?.[0]?.artist ||
          "Unknown";
        const imageUrl =
          card.image_uris?.small ||
          card.card_faces?.[0]?.image_uris?.small ||
          null;

        printings.push({
          artist,
          set: card.set,
          set_name: card.set_name,
          collector_number: card.collector_number,
          image_url: imageUrl,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    } catch {
      // 网络错误也重试
      if (attempt < 2) {
        await delay(1000 * (attempt + 1));
        return fetchAllPrintings(cardName, attempt + 1);
      }
      break;
    }
  }

  return printings;
}