import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchArtistCards, RateLimiter } from "@/lib/scryfall-client";
import { loadArtistAliases, resolveAliases } from "@/lib/artist-aliases";
import { buildFuzzyCardMap } from "@/lib/match-utils";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import type { ArtistCard } from "@/types";

// 反向查询并发数（配合 RateLimiter 10 req/s；中国到 Scryfall ~2s/次，
// 并发 6 时吞吐约 3/s，30 个画家 ≈ 10 秒冷启动）
const CONCURRENCY = 6;

// 画家数量上限（活动名单一般 20-30 位，留足余量）
const MAX_ARTISTS = 100;

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
    const { deckIds, artists } = body as { deckIds?: string[]; artists?: string[] };

    if (!deckIds || deckIds.length === 0) {
      return NextResponse.json({ error: "缺少套牌 ID" }, { status: 400 });
    }
    if (deckIds.length > 50) {
      return NextResponse.json({ error: "套牌数量过多（最多 50 个）" }, { status: 400 });
    }
    if (!artists || artists.length === 0) {
      return NextResponse.json({ error: "缺少画家名单" }, { status: 400 });
    }
    if (artists.length > MAX_ARTISTS) {
      return NextResponse.json({ error: `画家数量过多（最多 ${MAX_ARTISTS} 个）` }, { status: 400 });
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

    // 查询套牌内的卡名（反向查询返回画家的「全部卡」，需过滤到套牌范围，
    // 否则会把套牌里根本没有的卡误显示为「其他版本」）
    const validDeckIds = ownedDecks.map((d) => d.id);
    const { data: deckCards } = await supabase
      .from("cards")
      .select("card_name")
      .in("deck_id", validDeckIds);
    const deckNames = new Set((deckCards || []).map((c) => c.card_name));

    // 解析画家别名（覆盖「粘贴名单」和「活动日历」两条路径：
    // 粘贴路径在 parse-artists 已解析过，活动日历路径尚未解析，统一在此兜底）
    const aliasMap = await loadArtistAliases();
    const resolvedArtists = [...new Set(resolveAliases(artists, aliasMap))];

    // ── 第一步：批量查 artist_cards 缓存（按画家，跨套牌复用）──
    const { data: cachedRows } = await supabase
      .from("artist_cards")
      .select("artist_name, cards")
      .in("artist_name", resolvedArtists);

    const artistCardsMap = new Map<string, ArtistCard[]>();
    if (cachedRows) {
      for (const row of cachedRows) {
        if (row.cards && Array.isArray(row.cards)) {
          artistCardsMap.set(row.artist_name, row.cards as ArtistCard[]);
        }
      }
    }

    const missedArtists = resolvedArtists.filter((a) => !artistCardsMap.has(a));

    // ── 第二步：未命中的画家走 Scryfall 反向查询（按画家查卡）──
    const fetched: Array<{ artist: string; cards: ArtistCard[] }> = [];
    if (missedArtists.length > 0) {
      const rateLimiter = new RateLimiter(10);
      for (let i = 0; i < missedArtists.length; i += CONCURRENCY) {
        const batch = missedArtists.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async (artist) => {
            const { cards } = await fetchArtistCards(artist, rateLimiter);
            return { artist, cards };
          })
        );
        for (const r of batchResults) {
          artistCardsMap.set(r.artist, r.cards);
          fetched.push(r);
        }
      }
    }

    // 回写缓存（fire-and-forget，不阻塞响应）
    if (fetched.length > 0) {
      for (const r of fetched) {
        if (r.cards.length === 0) continue;
        supabase
          .from("artist_cards")
          .upsert(
            {
              artist_name: r.artist,
              cards: r.cards,
              card_count: r.cards.length,
            },
            { onConflict: "artist_name" }
          )
          .then(({ error }) => {
            if (error) console.warn(`[FuzzyMatch] 缓存写入失败 ${r.artist}:`, error.message);
          });
      }
    }

    // ── 第三步：反转成 cardMap（过滤到套牌范围，保持返回结构不变）──
    const cardMap = buildFuzzyCardMap(artistCardsMap, deckNames);

    return NextResponse.json({
      success: true,
      cardMap,
      cardCount: Object.keys(cardMap).length,
    });
  } catch (error) {
    console.error("[FuzzyMatch]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
