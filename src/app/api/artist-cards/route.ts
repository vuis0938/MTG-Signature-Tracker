import { NextRequest, NextResponse } from "next/server";
import { delay, SCRYFALL_UA } from "@/lib/scryfall-client";
import { getUserFromRequest } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import type { ArtistCard } from "@/types";

// ── 内存缓存（进程级，TTL 10 分钟） ──────────────────────
// 作为 Supabase 持久缓存之上的快速层，命中时 ~1ms 返回
const CACHE_TTL_MS = 10 * 60 * 1000;
const artistCache = new Map<string, { data: ArtistCard[]; ts: number }>();

function getCached(artist: string): ArtistCard[] | null {
  const entry = artistCache.get(artist);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    artistCache.delete(artist);
    return null;
  }
  return entry.data;
}

function setCached(artist: string, data: ArtistCard[]) {
  artistCache.set(artist, { data, ts: Date.now() });
  // 防止内存泄漏：超过 200 条时清理最旧的（Map 保持插入顺序，O(1)）
  if (artistCache.size > 200) {
    const oldestKey = artistCache.keys().next().value;
    if (oldestKey) artistCache.delete(oldestKey);
  }
}

export async function GET(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const artist = searchParams.get("artist");

    if (!artist?.trim()) {
      return NextResponse.json({ error: "缺少画家名称" }, { status: 400 });
    }

    const artistName = artist.trim();

    // ── 1. 优先查内存缓存（最快，~1ms） ─────────────────
    const memCached = getCached(artistName);
    if (memCached) {
      return NextResponse.json({
        success: true,
        artist: artistName,
        cards: memCached,
        count: memCached.length,
        cached: true,
      });
    }

    // ── 2. 查 Supabase 持久缓存（~50ms，部署后仍有效） ──
    const supabase = getSupabase();
    const { data: dbCached } = await supabase
      .from("artist_cards")
      .select("cards")
      .eq("artist_name", artistName)
      .single();

    if (dbCached?.cards && Array.isArray(dbCached.cards) && dbCached.cards.length > 0) {
      const cards = dbCached.cards as ArtistCard[];
      // 回填内存缓存，下次直接命中
      setCached(artistName, cards);
      return NextResponse.json({
        success: true,
        artist: artistName,
        cards,
        count: cards.length,
        cached: true,
      });
    }

    // ── 3. 缓存全未命中，查 Scryfall ────────────────────
    const allCards: ArtistCard[] = [];
    let pageUrl = `https://api.scryfall.com/cards/search?q=a:"${encodeURIComponent(artistName)}"+unique:prints&order=released`;

    let isFirstPage = true;
    while (pageUrl) {
      // Scryfall 限速：请求间隔 ≥100ms，但首页无需等待
      if (!isFirstPage) await delay(100);
      isFirstPage = false;
      const res = await fetch(pageUrl, {
        headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
      });

      if (res.status === 404) {
        // 404 也缓存（避免重复查询不存在的画家）
        setCached(artistName, []);
        return NextResponse.json(
          { error: `未找到画家 "${artist}" 的卡牌` },
          { status: 404 }
        );
      }

      if (!res.ok) {
        console.error(`[ArtistCards] HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      for (const card of data.data || []) {
        allCards.push({
          name: card.name,
          set: card.set,
          set_name: card.set_name,
          collector_number: card.collector_number,
          image_url:
            card.image_uris?.small ||
            card.image_uris?.normal ||
            card.card_faces?.[0]?.image_uris?.small ||
            card.card_faces?.[0]?.image_uris?.normal ||
            null,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    }

    // ── 4. 写入双层缓存（内存 + Supabase 持久化） ──────
    setCached(artistName, allCards);

    // Supabase 持久缓存写入（fire-and-forget，不阻塞响应）
    if (allCards.length > 0) {
      supabase
        .from("artist_cards")
        .upsert({
          artist_name: artistName,
          cards: allCards as unknown[],
          card_count: allCards.length,
        })
        .then(({ error }) => {
          if (error) {
            console.warn(`[ArtistCards] 持久缓存写入失败 ${artistName}:`, error.message);
          }
        });
    }

    return NextResponse.json({
      success: true,
      artist: artistName,
      cards: allCards,
      count: allCards.length,
      cached: false,
    });
  } catch (error) {
    console.error("[ArtistCards]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
