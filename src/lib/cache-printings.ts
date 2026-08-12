import { supabase } from "@/lib/supabase";
import { fetchAllPrintings, RateLimiter } from "@/lib/scryfall-client";

/** 缓存条目 */
interface CacheRow {
  card_name: string;
  printings: unknown[];
  all_artists: string[];
}

/**
 * 预热卡牌印刷版本缓存
 *
 * 接收一组去重卡牌名，先批量检查哪些已缓存，
 * 再只对未缓存的从 Scryfall 拉取所有印刷版本并写入 card_printings 表。
 *
 * 当 forceRefresh 为 true 时，跳过缓存检查，对所有卡牌重新拉取
 * 并 upsert 写入（覆盖旧数据），用于 Scryfall 数据更新后的缓存刷新。
 *
 * 提取为独立函数，供 API 路由和内部调用共用，避免 HTTP 自回环开销。
 */
export async function warmCardPrintingsCache(
  cardNames: string[],
  options?: { forceRefresh?: boolean }
): Promise<{
  cached: number;
  failed: number;
  total: number;
}> {
  if (cardNames.length === 0) {
    return { cached: 0, failed: 0, total: 0 };
  }

  const forceRefresh = options?.forceRefresh ?? false;
  const uniqueNames = [...new Set(cardNames)];
  const cached: string[] = [];
  const failed: string[] = [];

  let toFetch: string[];

  if (forceRefresh) {
    // 强制刷新：对所有卡牌重新拉取
    toFetch = uniqueNames;
  } else {
    // ── 批量查询已缓存的卡牌（并行批次，替代串行逐批查询） ──
    const EXIST_BATCH = 100;
    const existingNames = new Set<string>();

    const batches: string[][] = [];
    for (let i = 0; i < uniqueNames.length; i += EXIST_BATCH) {
      batches.push(uniqueNames.slice(i, i + EXIST_BATCH));
    }

    const batchResults = await Promise.all(
      batches.map((batch) =>
        supabase
          .from("card_printings")
          .select("card_name")
          .in("card_name", batch)
      )
    );

    for (const { data: existing } of batchResults) {
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
    toFetch = uniqueNames.filter((n) => !existingNames.has(n));
  }

  if (toFetch.length === 0) {
    return { cached: cached.length, failed: 0, total: uniqueNames.length };
  }

  const CONCURRENCY = 6;
  const rateLimiter = new RateLimiter(10);
  const rowsToInsert: CacheRow[] = [];

  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (name) => {
        const { printings, complete } = await fetchAllPrintings(name, rateLimiter);
        if (!complete || printings.length === 0) {
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
          printings: r.printings!,
          all_artists: r.allArtists!,
        });
      }
    }
  }

  // ── 写入数据库 ──
  if (rowsToInsert.length > 0) {
    if (forceRefresh) {
      // 强制刷新：使用 upsert 覆盖旧数据
      const { error: upsertError } = await supabase
        .from("card_printings")
        .upsert(rowsToInsert, { onConflict: "card_name" });

      if (upsertError) {
        console.warn("[CachePrintings] 批量 upsert 失败，降级:", upsertError.message);
        const upsertResults = await Promise.all(
          rowsToInsert.map(async (row) => {
            const { error } = await supabase.from("card_printings").upsert(row, { onConflict: "card_name" });
            return { name: row.card_name, ok: !error, errMsg: error?.message };
          })
        );
        for (const r of upsertResults) {
          if (r.ok) {
            cached.push(r.name);
          } else {
            console.warn(`[CachePrintings] 写入失败 ${r.name}:`, r.errMsg);
            failed.push(r.name);
          }
        }
      } else {
        for (const row of rowsToInsert) {
          cached.push(row.card_name);
        }
      }
    } else {
      // 正常模式：批量插入
      const { error: batchError } = await supabase
        .from("card_printings")
        .insert(rowsToInsert);

      if (batchError) {
        // 批量插入失败，降级为并行逐条插入
        console.warn("[CachePrintings] 批量插入失败，降级:", batchError.message);
        const insertResults = await Promise.all(
          rowsToInsert.map(async (row) => {
            const { error } = await supabase.from("card_printings").insert(row);
            return { name: row.card_name, ok: !error, errMsg: error?.message };
          })
        );
        for (const r of insertResults) {
          if (r.ok) {
            cached.push(r.name);
          } else {
            console.warn(`[CachePrintings] 写入失败 ${r.name}:`, r.errMsg);
            failed.push(r.name);
          }
        }
      } else {
        for (const row of rowsToInsert) {
          cached.push(row.card_name);
        }
      }
    }
  }

  return {
    cached: cached.length,
    failed: failed.length,
    total: uniqueNames.length,
  };
}