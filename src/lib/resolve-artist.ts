import "server-only";
import { fetchArtistCards, extractCanonicalArtist } from "@/lib/scryfall-client";
import type { RateLimiter } from "@/lib/scryfall-client";
import { getSupabase } from "@/lib/supabase";
import { loadAllArtists } from "@/lib/artists-catalog";
import { matchArtistName } from "@/lib/match-utils";
import type { ArtistCard } from "@/types";

/**
 * 缓存画家的卡牌到 artist_cards 表（fire-and-forget，匹配阶段读缓存秒出）。
 */
function cacheArtistCards(artistName: string, cards: ArtistCard[]): void {
  if (cards.length === 0) return;
  getSupabase()
    .from("artist_cards")
    .upsert(
      { artist_name: artistName, cards, card_count: cards.length },
      { onConflict: "artist_name" }
    )
    .then(({ error }) => {
      if (error) console.warn(`[ResolveArtist] 缓存写入失败 ${artistName}:`, error.message);
    });
}

/**
 * 在本地全量画家名单里匹配（精确优先，其次三关模糊）。
 * 命中返回标准名；未命中/歧义返回 null（调用方走 Scryfall 精确查兜底）。
 */
async function matchLocalArtist(target: string): Promise<string | null> {
  const names = await loadAllArtists();
  if (names.length === 0) return null;

  const lower = target.toLowerCase().trim();
  const exact = names.find((n) => n.toLowerCase().trim() === lower);
  if (exact) return exact;

  return matchArtistName(target, names);
}

/**
 * 解析画家名（纯函数，不写库）：把可能有错的名字解析成 Scryfall 标准名。
 *
 * 流程：
 * 1. 本地全量名单匹配（零 Scryfall）：精确 → 三关模糊（编辑距离 ≤1 + 候选唯一）
 * 2. 本地未命中 → Scryfall 精确查一次 a:"全名"（兜底名单未覆盖的新画家）
 *
 * 返回 { canonical, cards }：canonical 为标准名（找不到为 null），cards 为该画家的卡牌
 * （本地命中时 cards 为空，卡牌在匹配阶段再查）。
 * 不写缓存——由调用方决定。
 */
async function resolveArtistCanonical(
  name: string,
  rateLimiter?: RateLimiter,
): Promise<{ canonical: string | null; cards: ArtistCard[] }> {
  const target = name.trim();
  if (!target) return { canonical: null, cards: [] };

  // 1. 本地全量名单匹配（零 Scryfall）
  const local = await matchLocalArtist(target);
  if (local) return { canonical: local, cards: [] };

  // 2. 本地未命中 → Scryfall 精确查一次（兜底新画家）
  const { cards } = await fetchArtistCards(target, rateLimiter);
  if (cards.length > 0) {
    // 从卡牌的 artist 字段提取 Scryfall 标准拼写（统一大小写/空格），提取不到回退输入名
    const canonical = extractCanonicalArtist(target, cards) || target;
    return { canonical, cards };
  }

  return { canonical: null, cards: [] };
}

/**
 * 解析画家名：把可能有错的名字解析成 Scryfall 标准名，并缓存卡牌。
 *
 * 返回标准名；无法解析返回 null（调用方标记为「未识别」）。
 *
 * 注：不再自动写别名自愈——全量名单的本地匹配已覆盖大小写/变音/编辑距离 ≤1 的错名，
 * 别名表仅保留给管理员手动配置（兜底本地匹配覆盖不了的距离 >1 / 歧义错名）。
 */
export async function resolveArtistName(
  name: string,
  rateLimiter?: RateLimiter,
): Promise<string | null> {
  const { canonical, cards } = await resolveArtistCanonical(name.trim(), rateLimiter);
  if (!canonical) return null;

  // 缓存卡牌（以标准名为键）
  cacheArtistCards(canonical, cards);

  return canonical;
}
