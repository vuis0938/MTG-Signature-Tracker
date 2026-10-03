import "server-only";
import { fetchArtistCards, fetchArtistCandidates, extractCanonicalArtist } from "@/lib/scryfall-client";
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
 * 解析画家名（纯函数，不写库）：把可能有错的名字解析成 Scryfall 标准名。
 *
 * 流程（层层递进，代价随层递增）：
 * 1. 精确查询 a:"全名" → 命中则从卡牌提取标准名（并返回卡牌）
 * 2. 降级查询 a:"姓氏" 收集候选画家名
 * 3. 三关模糊匹配（名+姓编辑距离 ≤1 且候选唯一，保守防错）
 * 4. 二次验证：用标准名再查一次，查空则放弃
 *
 * 返回 { canonical, cards }：canonical 为标准名（找不到为 null），cards 为该画家的卡牌。
 * 不写缓存/别名——由调用方决定（在线路径 fire-and-forget，清理端点统一写）。
 */
export async function resolveArtistCanonical(
  name: string,
  rateLimiter?: RateLimiter,
): Promise<{ canonical: string | null; cards: ArtistCard[] }> {
  const target = name.trim();
  if (!target) return { canonical: null, cards: [] };

  // 1. 精确查询（名字本身就在 Scryfall 上存在）
  const { cards } = await fetchArtistCards(target, rateLimiter);
  if (cards.length > 0) {
    // 从卡牌的 artist 字段提取 Scryfall 标准拼写（统一大小写/空格），提取不到回退输入名
    const canonical = extractCanonicalArtist(target, cards) || target;
    return { canonical, cards };
  }

  // 2. 降级查询：按姓氏收集候选画家名
  const words = target.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { canonical: null, cards: [] };
  const surname = words[words.length - 1];
  const candidates = await fetchArtistCandidates(surname, rateLimiter);
  if (candidates.length === 0) return { canonical: null, cards: [] };

  // 3. 三关模糊匹配
  const matched = matchArtistName(target, candidates);
  if (!matched) return { canonical: null, cards: [] };

  // 4. 二次验证：标准名必须真实存在
  const { cards: verified } = await fetchArtistCards(matched, rateLimiter);
  if (verified.length === 0) return { canonical: null, cards: [] };

  return { canonical: matched, cards: verified };
}

/**
 * 解析画家名并自愈：把可能有错的名字解析成 Scryfall 标准名，
 * 同时缓存卡牌 + 写别名（fire-and-forget，失败不影响主流程）。
 *
 * 返回标准名；无法解析返回 null（调用方标记为「未识别」）。
 */
export async function resolveArtistName(
  name: string,
  rateLimiter?: RateLimiter,
): Promise<string | null> {
  const target = name.trim();
  const { canonical, cards } = await resolveArtistCanonical(target, rateLimiter);
  if (!canonical) return null;

  // 缓存卡牌（以标准名为键）+ 写别名自愈（精确命中的大小写变体也会在此自愈）
  cacheArtistCards(canonical, cards);
  if (safeNormalize(canonical.toLowerCase()) !== safeNormalize(target.toLowerCase())) {
    writeAlias(target, canonical);
  }

  return canonical;
}
