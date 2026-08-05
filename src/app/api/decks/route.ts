import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

// GET: 获取当前用户的套牌列表（含统计信息）
export async function GET(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：高频读取，60 次/分钟
  const ip = getClientIP(request);
  const limit = rateLimit(`decks:${ip}`, 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const supabase = getSupabase();

    const { data: decks, error } = await supabase
      .from("decks")
      .select("id, name, source, created_at")
      .eq("user_name", userName)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Decks API] 查询失败:", error.message);
      return NextResponse.json({ error: "获取套牌失败" }, { status: 500 });
    }

    if (!decks || decks.length === 0) {
      return NextResponse.json({ success: true, decks: [], stats: {} });
    }

    // 单条查询拉取所有卡牌的 deck_id + status，在内存中聚合统计
    // 替代原先 N×3 条 Supabase 查询（N+1 问题）
    const deckIds = decks.map((d) => d.id);
    const { data: allCards } = await supabase
      .from("cards")
      .select("deck_id, status")
      .in("deck_id", deckIds);

    const stats: Record<string, { total: number; unsigned: number; pending: number }> = {};
    for (const deck of decks) {
      stats[deck.id] = { total: 0, unsigned: 0, pending: 0 };
    }
    if (allCards) {
      for (const card of allCards) {
        const s = stats[card.deck_id];
        if (!s) continue;
        s.total++;
        if (card.status === 1) s.pending++;
        else if (card.status === 0 || card.status === 3) s.unsigned++;
      }
    }

    return NextResponse.json({ success: true, decks, stats });
  } catch (error) {
    console.error("[Decks API]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// DELETE: 删除套牌（同时删除其下所有卡牌）
export async function DELETE(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const deckId = request.nextUrl.searchParams.get("deckId");
    if (!deckId) {
      return NextResponse.json({ error: "缺少套牌 ID" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证套牌属于当前用户
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .select("id")
      .eq("id", deckId)
      .eq("user_name", userName)
      .single();

    if (deckError || !deck) {
      return NextResponse.json({ error: "套牌不存在" }, { status: 404 });
    }

    // 先删除卡牌，再删除套牌
    await supabase.from("cards").delete().eq("deck_id", deckId);
    const { error: deleteError } = await supabase
      .from("decks")
      .delete()
      .eq("id", deckId);

    if (deleteError) {
      console.error("[Decks API] 删除失败:", deleteError.message);
      return NextResponse.json({ error: "删除失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Decks API DELETE]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
