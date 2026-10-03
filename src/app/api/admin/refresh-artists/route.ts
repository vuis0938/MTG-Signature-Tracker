import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";
import { fetchScryfallArtistCatalog, invalidateArtistsCache } from "@/lib/artists-catalog";

// 分批 upsert 大小（2439 个名字分 5 批写入）
const BATCH = 500;

/**
 * 刷新本地全量画家名单：拉取 Scryfall /catalog/artist-names 写入 artists 表。
 * 解析阶段纠错会优先查这张表，本地未命中再降级打 Scryfall。
 */
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const names = await fetchScryfallArtistCatalog();
    if (names.length === 0) {
      return NextResponse.json({ error: "未从 Scryfall 获取到画家名单" }, { status: 502 });
    }

    const supabase = getSupabase();
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH).map((name) => ({ name }));
      const { error } = await supabase.from("artists").upsert(batch, { onConflict: "name" });
      if (error) {
        console.error("[Refresh Artists] 写入失败:", error.message);
        return NextResponse.json({ error: "写入画家名单失败，请确认已执行 010_artist_names.sql 建表" }, { status: 500 });
      }
    }

    invalidateArtistsCache();

    await logAdminAction(adminName, "artist_refresh", undefined, { count: names.length });

    return NextResponse.json({ success: true, count: names.length });
  } catch (err) {
    console.error("[Refresh Artists]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
