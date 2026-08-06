import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";

export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();

    // 并行查询所有统计数据（含卡牌聚合数据，原先串行查两次）
    const [
      usersRes,
      decksRes,
      cardsRes,
      signedCardsRes,
      pendingCardsRes,
      recentLogsRes,
      cardsAggRes,
    ] = await Promise.all([
      // 用户总数
      supabase.from("users").select("username, created_at, last_active_at, banned_at", { count: "exact" }),
      // 套牌总数
      supabase.from("decks").select("id", { count: "exact", head: true }),
      // 卡牌总数
      supabase.from("cards").select("id", { count: "exact", head: true }),
      // 已签卡牌数
      supabase.from("cards").select("id", { count: "exact", head: true }).eq("status", 2),
      // 送签中卡牌数
      supabase.from("cards").select("id", { count: "exact", head: true }).eq("status", 1),
      // 最近 20 条审计日志
      supabase
        .from("admin_logs")
        .select("id, admin_user, action, target, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      // 卡牌聚合数据（合并原先两次串行查询为一次）
      supabase.from("cards").select("artist_names, set_name").limit(5000),
    ]);

    const users = usersRes.data || [];

    // 计算活跃用户（7天/30天内 last_active_at）
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const active7d = users.filter(
      (u) => u.last_active_at && new Date(u.last_active_at).getTime() > sevenDaysAgo,
    ).length;
    const active30d = users.filter(
      (u) => u.last_active_at && new Date(u.last_active_at).getTime() > thirtyDaysAgo,
    ).length;
    const bannedUsers = users.filter((u) => u.banned_at !== null).length;

    // 注册趋势（最近 14 天，按日期分组）
    const registrationTrend: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const dateKey = d.toISOString().slice(0, 10);
      registrationTrend[dateKey] = 0;
    }
    users.forEach((u) => {
      if (u.created_at) {
        const dateKey = u.created_at.slice(0, 10);
        if (dateKey in registrationTrend) {
          registrationTrend[dateKey]++;
        }
      }
    });

    // 热门画家 Top 10 + 热门系列 Top 10（从单次聚合查询计算）
    const cardsAgg = cardsAggRes.data || [];
    const artistCounts: Record<string, number> = {};
    const setCounts: Record<string, number> = {};
    cardsAgg.forEach((card) => {
      if (card.artist_names && Array.isArray(card.artist_names)) {
        card.artist_names.forEach((artist: string) => {
          artistCounts[artist] = (artistCounts[artist] || 0) + 1;
        });
      }
      if (card.set_name) {
        setCounts[card.set_name] = (setCounts[card.set_name] || 0) + 1;
      }
    });
    const topArtists = Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
    const topSets = Object.entries(setCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const totalCards = cardsRes.count ?? 0;
    const signedCards = signedCardsRes.count ?? 0;

    return NextResponse.json({
      success: true,
      stats: {
        totalUsers: users.length,
        activeUsers7d: active7d,
        activeUsers30d: active30d,
        bannedUsers,
        totalDecks: decksRes.count ?? 0,
        totalCards,
        signedCards,
        pendingCards: pendingCardsRes.count ?? 0,
        unsignedCards: totalCards - signedCards - (pendingCardsRes.count ?? 0),
        signRate: totalCards > 0 ? Math.round((signedCards / totalCards) * 100) : 0,
      },
      registrationTrend: Object.entries(registrationTrend).map(([date, count]) => ({ date, count })),
      topArtists,
      topSets,
      recentLogs: recentLogsRes.data || [],
    });
  } catch (err) {
    console.error("[Admin Dashboard API]", err);
    return NextResponse.json({ error: "获取仪表盘数据失败" }, { status: 500 });
  }
}
