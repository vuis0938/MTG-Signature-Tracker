import { NextRequest, NextResponse } from "next/server";
import { delay, SCRYFALL_UA } from "@/lib/scryfall-client";
import { getUserFromRequest } from "@/lib/auth";
import type { ArtistCard } from "@/types";

// ── 内存缓存（进程级，TTL 10 分钟） ──────────────────────
// 同一画家的卡牌列表变更频率极低，缓存 10 分钟后自动过期重新查 Scryfall
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
  // 防止内存泄漏：超过 200 条缓存时清理最旧的
  if (artistCache.size > 200) {
    const oldest = [...artistCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) artistCache.delete(oldest[0]);
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

    // ── 1. 优先查内存缓存 ────────────────────────────────
    const cached = getCached(artistName);
    if (cached) {
      return NextResponse.json({
        success: true,
        artist: artistName,
        cards: cached,
        count: cached.length,
        cached: true,
      });
    }

    // ── 2. 缓存未命中，查 Scryfall ──────────────────────
    const allCards: ArtistCard[] = [];
    let pageUrl = `https://api.scryfall.com/cards/search?q=a:"${encodeURIComponent(artistName)}"+unique:prints&order=released`;

    while (pageUrl) {
      await delay(100);
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
            card.image_uris?.normal ||
            card.image_uris?.small ||
            card.card_faces?.[0]?.image_uris?.normal ||
            card.card_faces?.[0]?.image_uris?.small ||
            null,
          released_at: card.released_at,
        });
      }

      pageUrl = data.has_more ? data.next_page : null;
    }

    // ── 3. 写入内存缓存 ────────────────────────────────
    setCached(artistName, allCards);

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
