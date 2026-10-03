import "server-only";
import { getSupabase } from "@/lib/supabase";
import { SCRYFALL_BASE_URL, SCRYFALL_UA } from "@/lib/scryfall-client";

// ─── 模块级内存缓存（TTL 1 小时）────────────────────────────
// 避免每次解析都读 ~2400 行的 artists 表。冷启动第一次读库，之后命中内存。

let cache: { names: string[]; ts: number } | null = null;
const TTL_MS = 60 * 60 * 1000;

/** 清除内存缓存（刷新名单后调用，让下次立即读新数据） */
export function invalidateArtistsCache(): void {
  cache = null;
}

/**
 * 加载本地全量画家标准名单（来自 artists 表）。
 *
 * 表为空（尚未刷新）或查询失败时返回空数组——调用方会回退到 Scryfall 降级，
 * 功能不降级，只是少了「本地优先」的优化。
 */
export async function loadAllArtists(): Promise<string[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.names;

  try {
    const { data, error } = await getSupabase().from("artists").select("name");
    if (error) {
      console.warn("[ArtistsCatalog] 读取本地名单失败:", error.message);
      return cache?.names || [];
    }
    const names = (data || [])
      .map((r) => (r as { name: string }).name)
      .filter(Boolean);
    // 空结果不缓存：避免「刷新名单前读到空表」被锁死 1 小时，
    // 导致解析全部回退 Scryfall。下次会重新读库。
    if (names.length > 0) {
      cache = { names, ts: Date.now() };
    }
    return names;
  } catch {
    return cache?.names || [];
  }
}

/**
 * 拉取 Scryfall 全量画家名单（/catalog/artist-names）。
 * 返回去重后的画家名数组（约 2400+ 位）。
 */
export async function fetchScryfallArtistCatalog(): Promise<string[]> {
  const res = await fetch(`${SCRYFALL_BASE_URL}/catalog/artist-names`, {
    headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Scryfall 返回 HTTP ${res.status}`);
  }
  const data = await res.json();
  const names = Array.isArray(data?.data) ? (data.data as string[]) : [];
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
}
