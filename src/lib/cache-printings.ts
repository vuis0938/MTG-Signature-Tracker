import { supabase } from "@/lib/supabase";
import { fetchAllPrintings, delay } from "@/lib/scryfall-client";

/**
 * 预热卡牌印刷版本缓存
 *
 * 接收一组去重卡牌名，先批量检查哪些已缓存，
 * 再只对未缓存的从 Scryfall 拉取所有印刷版本并写入 card_printings 表。
 *
 * 提取为独立函数，供 API 路由和内部调用共用，避免 HTTP 自回环开销。
 */
export async function warmCardPrintingsCache(cardNames: string[]): Promise<{
  cached: number;
  failed: number;
  total: number;
}> {
  if (cardNames.length === 0) {
    return { cached: 0, failed: 0, total: 0 };
  }

  const uniqueNames = [...new Set(cardNames)];
  const cached: string[] = [];
  const failed: string[] = [];

  // ── 批量查询已缓存的卡牌（替代 N+1 逐条查询） ──
  const EXIST_BATCH = 100;
  const existingNames = new Set<string>();

  for (let i = 0; i < uniqueNames.length; i += EXIST_BATCH) {
    const batch = uniqueNames.slice(i, i + EXIST_BATCH);
    const { data: existing } = await supabase
      .from("card_printings")
      .select("card_name")
      .in("card_name", batch);

    if (existing) {
      for (const row of existing) {
        existingNames.add(row.card_name);
      }
    }
  }

  // 已缓存的直接记录
  for (const name of existingNames) {
    cached.push(name);
  }

  // 只对未缓存的卡牌从 Scryfall 拉取
  const toFetch = uniqueNames.filter((n) => !existingNames.has(n));
  if (toFetch.length === 0) {
    return { cached: cached.length, failed: 0, total: uniqueNames.length };
  }

  const CONCURRENCY = 6;
  const rowsToInsert: Array<{
    card_name: string;
    printings: unknown[];
    all_artists: string[];
  }> = [];

  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (name) => {
        const printings = await fetchAllPrintings(name);
        if (printings.length === 0) {
          return { name, failed: true };
        }

        const allArtists = [...new Set(printings.map((p) => p.artist))];
        return { name, printings, allArtists, failed: false };
      })
    );

    for (const r of results) {
      if (r.failed) {
        failed.push(r.name);
      } else {
        rowsToInsert.push({
          card_name: r.name,
          printings: r.printings as unknown[],
          all_artists: r.allArtists!,
        });
      }
    }

    if (i + CONCURRENCY < toFetch.length) await delay(150);
  }

  // ── 批量插入（替代逐条 insert） ──
  if (rowsToInsert.length > 0) {
    const { error: batchError } = await supabase
      .from("card_printings")
      .insert(rowsToInsert);

    if (batchError) {
      // 批量插入失败，降级为逐条插入
      console.warn("[CachePrintings] 批量插入失败，降级:", batchError.message);
      for (const row of rowsToInsert) {
        const { error } = await supabase.from("card_printings").insert(row);
        if (error) {
          console.warn(`[CachePrintings] 写入失败 ${row.card_name}:`, error.message);
          failed.push(row.card_name);
        } else {
          cached.push(row.card_name);
        }
      }
    } else {
      for (const row of rowsToInsert) {
        cached.push(row.card_name);
      }
    }
  }

  return {
    cached: cached.length,
    failed: failed.length,
    total: uniqueNames.length,
  };
}
