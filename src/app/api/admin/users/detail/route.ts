import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";

// GET: 用户详情（套牌列表 + 卡牌统计 + 签绘状态分布）
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");

    if (!username) {
      return NextResponse.json({ error: "缺少用户名参数" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 1. 用户基本信息
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("username, created_at, last_active_at, banned_at")
      .eq("username", username)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    // 2. 用户套牌列表
    const { data: decks, error: decksError } = await supabase
      .from("decks")
      .select("id, name, created_at, updated_at")
      .eq("user_name", username)
      .order("created_at", { ascending: false });

    if (decksError) {
      console.error("[Admin User Detail API] 套牌查询失败:", decksError.message);
    }

    // 3. 每副套牌的卡牌统计
    const deckIds = (decks || []).map((d) => d.id);
    let cardsByDeck: Record<string, { total: number; signed: number; pending: number; unsigned: number }> = {};

    if (deckIds.length > 0) {
      const { data: cards, error: cardsError } = await supabase
        .from("cards")
        .select("deck_id, status")
        .in("deck_id", deckIds);

      if (cardsError) {
        console.error("[Admin User Detail API] 卡牌查询失败:", cardsError.message);
      }

      if (cards) {
        for (const c of cards) {
          if (!cardsByDeck[c.deck_id]) {
            cardsByDeck[c.deck_id] = { total: 0, signed: 0, pending: 0, unsigned: 0 };
          }
          cardsByDeck[c.deck_id].total++;
          if (c.status === 2) cardsByDeck[c.deck_id].signed++;
          else if (c.status === 1) cardsByDeck[c.deck_id].pending++;
          else cardsByDeck[c.deck_id].unsigned++;
        }
      }
    }

    // 4. 汇总统计
    const totalCards = Object.values(cardsByDeck).reduce((sum, d) => sum + d.total, 0);
    const totalSigned = Object.values(cardsByDeck).reduce((sum, d) => sum + d.signed, 0);
    const totalPending = Object.values(cardsByDeck).reduce((sum, d) => sum + d.pending, 0);
    const totalUnsigned = Object.values(cardsByDeck).reduce((sum, d) => sum + d.unsigned, 0);

    // 5. 热门画家（该用户收藏最多的画家）
    let topArtists: { name: string; count: number }[] = [];
    if (deckIds.length > 0) {
      const { data: artistCards } = await supabase
        .from("cards")
        .select("artist")
        .in("deck_id", deckIds)
        .not("artist", "is", null);

      if (artistCards) {
        const artistCount: Record<string, number> = {};
        for (const c of artistCards) {
          if (c.artist) {
            artistCount[c.artist] = (artistCount[c.artist] || 0) + 1;
          }
        }
        topArtists = Object.entries(artistCount)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
      }
    }

    const decksWithStats = (decks || []).map((d) => ({
      ...d,
      cardCount: cardsByDeck[d.id]?.total || 0,
      signedCount: cardsByDeck[d.id]?.signed || 0,
      pendingCount: cardsByDeck[d.id]?.pending || 0,
      unsignedCount: cardsByDeck[d.id]?.unsigned || 0,
    }));

    return NextResponse.json({
      success: true,
      user: {
        username: user.username,
        createdAt: user.created_at,
        lastActiveAt: user.last_active_at,
        bannedAt: user.banned_at,
        isBanned: user.banned_at !== null,
      },
      decks: decksWithStats,
      stats: {
        totalDecks: decksWithStats.length,
        totalCards,
        totalSigned,
        totalPending,
        totalUnsigned,
        signRate: totalCards > 0 ? Math.round((totalSigned / totalCards) * 100) : 0,
      },
      topArtists,
    });
  } catch (err) {
    console.error("[Admin User Detail API]", err);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}
