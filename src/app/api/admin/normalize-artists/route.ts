import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";
import { resolveArtistCanonical } from "@/lib/resolve-artist";
import { RateLimiter } from "@/lib/scryfall-client";
import type { ArtistCard } from "@/types";

// 反向查询并发数（与 fuzzy-match 一致，配合 RateLimiter 10 req/s）
const CONCURRENCY = 6;

/**
 * 一键标准化本地画家名单：把 artist_cards / artist_aliases 里的画家名
 * 统一成 Scryfall 标准拼写，并归并大小写/空格变体。
 *
 * 幂等：中途超时可重跑，已标准化的部分会被覆盖/跳过。
 */
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  const supabase = getSupabase();

  try {
    // 1. 读本地画家缓存 + 别名表
    const [cacheRes, aliasRes] = await Promise.all([
      supabase.from("artist_cards").select("artist_name, cards"),
      supabase.from("artist_aliases").select("alias, canonical_name"),
    ]);

    const cacheRows = (cacheRes.data || []) as Array<{ artist_name: string; cards: ArtistCard[] }>;
    const aliasRows = (aliasRes.data || []) as Array<{ alias: string; canonical_name: string }>;

    // 2. 汇总待处理名字（lowercase 去重，保留一个代表名）
    const nameSet = new Map<string, string>(); // lowercase -> 代表名
    const addName = (n?: string | null) => {
      if (!n) return;
      const key = n.toLowerCase().trim();
      if (key && !nameSet.has(key)) nameSet.set(key, n.trim());
    };
    for (const row of cacheRows) addName(row.artist_name);
    for (const row of aliasRows) {
      addName(row.alias);
      addName(row.canonical_name);
    }

    const names = [...nameSet.values()];

    // 3. 并发解析标准名（不写库，结果统一收集）
    const rateLimiter = new RateLimiter(10);
    const results: Array<{ original: string; canonical: string | null; cards: ArtistCard[] }> = [];
    for (let i = 0; i < names.length; i += CONCURRENCY) {
      const batch = names.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (original) => {
          const { canonical, cards } = await resolveArtistCanonical(original, rateLimiter);
          return { original, canonical, cards };
        })
      );
      results.push(...batchResults);
    }

    // 4. 汇总 canonical -> cards 与 变体 -> canonical
    const canonicalCards = new Map<string, ArtistCard[]>();
    const variantMap = new Map<string, string>(); // 变体(原样) -> canonical
    const seenCanonicalLower = new Set<string>();
    let resolvedCount = 0;
    let mergedVariants = 0;

    for (const r of results) {
      if (!r.canonical) continue; // 无法标准化的跳过，保留原样
      resolvedCount++;
      const canonLower = r.canonical.toLowerCase().trim();

      // 同一 canonical 多个来源时，取卡牌更多的那份
      const existing = canonicalCards.get(r.canonical);
      if (!existing || r.cards.length > existing.length) {
        canonicalCards.set(r.canonical, r.cards);
      }

      if (r.original.toLowerCase().trim() !== canonLower) {
        variantMap.set(r.original, r.canonical);
        mergedVariants++;
      }
      seenCanonicalLower.add(canonLower);
    }

    // 5. 写库（并发执行、幂等，失败可重跑）
    // 5a. upsert artist_cards（标准名为键）
    const cardUpserts = [...canonicalCards.entries()]
      .filter(([, cards]) => cards.length > 0)
      .map(async ([canonical, cards]) => {
        const { error } = await supabase
          .from("artist_cards")
          .upsert(
            { artist_name: canonical, cards, card_count: cards.length },
            { onConflict: "artist_name" }
          );
        if (error) console.warn(`[Normalize] 缓存写入失败 ${canonical}:`, error.message);
      });

    // 5b. upsert artist_aliases（变体 -> 标准名）
    const aliasUpserts = [...variantMap.entries()].map(async ([alias, canonical]) => {
      const { error } = await supabase
        .from("artist_aliases")
        .upsert({ alias, canonical_name: canonical }, { onConflict: "alias" });
      if (error) console.warn(`[Normalize] 别名写入失败 ${alias} → ${canonical}:`, error.message);
    });

    // 5c. 删除 artist_cards 里「键是大小写变体」的旧行
    //     （键本身不是 canonical，但 lowercase 命中某 canonical → 归并删除）
    const deleteKeys = cacheRows
      .filter(
        (row) =>
          !canonicalCards.has(row.artist_name) &&
          seenCanonicalLower.has(row.artist_name.toLowerCase().trim())
      )
      .map((row) => row.artist_name);

    const deleteResults = await Promise.all(
      deleteKeys.map(async (key): Promise<number> => {
        const { error } = await supabase.from("artist_cards").delete().eq("artist_name", key);
        if (error) {
          console.warn(`[Normalize] 删除变体行失败 ${key}:`, error.message);
          return 0;
        }
        return 1;
      })
    );
    const deletedKeys = deleteResults.reduce((s, n) => s + n, 0);

    await Promise.all([...cardUpserts, ...aliasUpserts]);

    await logAdminAction(adminName, "artist_normalize", undefined, {
      totalNames: names.length,
      resolved: resolvedCount,
      mergedVariants,
      deletedKeys,
    });

    return NextResponse.json({
      success: true,
      total: names.length,
      resolved: resolvedCount,
      mergedVariants,
      deletedKeys,
    });
  } catch (err) {
    console.error("[Normalize Artists]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
