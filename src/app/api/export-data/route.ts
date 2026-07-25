import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const userName = request.cookies.get("user_name")?.value || "默认用户";

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