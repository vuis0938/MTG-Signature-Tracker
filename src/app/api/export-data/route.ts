import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {

    const { data: decks } = await supabase
      .from("decks")
      .select("*")
      .eq("user_name", userName)
      .order("created_at", { ascending: false });

    const { data: cards } = await supabase
      .from("cards")
      .select("*")
      .in(
        "deck_id",
        (decks || []).map((d) => d.id)
      )
      .order("artist_names");

    return NextResponse.json({
      success: true,
      exportedAt: new Date().toISOString(),
      userName,
      deckCount: decks?.length || 0,
      cardCount: cards?.length || 0,
      decks: decks || [],
      cards: cards || [],
    });
  } catch (error) {
    console.error("[ExportData]", error);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}