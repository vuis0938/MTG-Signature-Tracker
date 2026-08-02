import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";

// GET: 获取当前用户的套牌列表（含统计信息）
export async function GET(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const supabase = getSupabase();

    const { data: decks, error } = await supabase
      .from("decks")
      .select("*")
      .eq("user_name", userName)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Decks API] 查询失败:", error.message);
      return NextResponse.json({ error: "获取套牌失败" }, { status: 500 });
    }

    if (!decks || decks.length === 0) {
      return NextResponse.json({ success: true, decks: [], stats: {} });
    }

    // 批量查询每个套牌的统计
    const stats: Record<string, { total: number; unsigned: number; pending: number }> = {};

    await Promise.all(
      decks.map(async (deck) => {
        const [{ count: total }, { count: unsigned }, { count: pending }] =
          await Promise.all([
            supabase
              .from("cards")
              .select("*", { count: "exact", head: true })
              .eq("deck_id", deck.id),
            supabase
              .from("cards")
              .select("*", { count: "exact", head: true })
              .eq("deck_id", deck.id)
              .in("status", [0, 3]),
            supabase
              .from("cards")
              .select("*", { count: "exact", head: true })
              .eq("deck_id", deck.id)
              .eq("status", 1),
          ]);
        stats[deck.id] = {
          total: total ?? 0,
          unsigned: unsigned ?? 0,
          pending: pending ?? 0,
        };
      })
    );

    return NextResponse.json({ success: true, decks, stats });
  } catch (error) {
    console.error("[Decks API]", error);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
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
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}
