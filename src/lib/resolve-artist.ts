import "server-only";
import { fetchArtistCards, fetchArtistCandidates } from "@/lib/scryfall-client";
import type { RateLimiter } from "@/lib/scryfall-client";
import { getSupabase } from "@/lib/supabase";
import { matchArtistName, safeNormalize } from "@/lib/match-utils";
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
 * 写别名（错误名 → 标准名），自愈：下次同名直接命中别名表。
 * alias 列有唯一约束，用 upsert 幂等覆盖。
 */
function writeAlias(alias: string, canonical: string): void {
  getSupabase()
    .from("artist_aliases")
    .upsert({ alias, canonical_name: canonical }, { onConflict: "alias" })
    .then(({ error }) => {
      if (error) console.warn(`[ResolveArtist] 别名写入失败 ${alias} → ${canonical}:`, error.message);
    });
}

/**
 * 解析画家名：把可能有错的名字解析成 Scryfall 上的标准名。
 *
 * 流程（层层递进，代价随层递增）：
 * 1. 精确查询 a:"全名" → 命中直接返回（并缓存卡牌）
 * 2. 降级查询 a:"姓氏" 收集候选画家名
 * 3. 三关模糊匹配（名+姓编辑距离 ≤1 且候选唯一，保守防错）
 * 4. 二次验证：用标准名再查一次，查空则放弃
 * 5. 写别名自愈 + 缓存卡牌
 *
 * 返回标准名；无法解析返回 null（调用方标记为「未识别」）。
 */
export async function resolveArtistName(
  name: string,
  rateLimiter?: RateLimiter,
): Promise<string | null> {
  const target = name.trim();
  if (!target) return null;

  // 1. 精确查询（名字本身就在 Scryfall 上存在）
  const { cards } = await fetchArtistCards(target, rateLimiter);
  if (cards.length > 0) {
    cacheArtistCards(target, cards);
    return target;
  }

  // 2. 降级查询：按姓氏收集候选画家名
  const words = target.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const surname = words[words.length - 1];
  const candidates = await fetchArtistCandidates(surname, rateLimiter);
  if (candidates.length === 0) return null;

  // 3. 三关模糊匹配
  const matched = matchArtistName(target, candidates);
  if (!matched) return null;

  // 4. 二次验证：标准名必须真实存在
  const { cards: verified } = await fetchArtistCards(matched, rateLimiter);
  if (verified.length === 0) return null;

  // 5. 缓存卡牌 + 写别名自愈
  cacheArtistCards(matched, verified);
  if (safeNormalize(matched.toLowerCase()) !== safeNormalize(target.toLowerCase())) {
    writeAlias(target, matched);
  }

  return matched;
}
