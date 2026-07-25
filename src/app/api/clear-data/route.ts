import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function DELETE(request: NextRequest) {
  try {
    const userName = request.cookies.get("user_name")?.value || "默认用户";

    // 获取用户所有套牌
    const { data: decks } = await supabase
      .from("decks")
      .select("id")
      .eq("user_name", userName);

    const deckIds = (decks || []).map((d) => d.id);

    // 删除卡牌
    if (deckIds.length > 0) {
      await supabase.from("cards").delete().in("deck_id", deckIds);
    }

    // 删除套牌
    await supabase.from("decks").delete().eq("user_name", userName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ClearData]", error);
    return NextResponse.json({ error: "清除数据失败" }, { status: 500 });
  }
}