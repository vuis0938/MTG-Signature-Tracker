import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

export async function DELETE(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：高危操作，限制频率
  const ip = getClientIP(request);
  const limit = rateLimit(`clear-data:${ip}`, 5, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  try {

    // 获取用户所有套牌
    const { data: decks } = await supabase
      .from("decks")
      .select("id")
      .eq("user_name", userName);

    const deckIds = (decks || []).map((d) => d.id);

    // 删除卡牌
    if (deckIds.length > 0) {
      const { error: cardsError } = await supabase.from("cards").delete().in("deck_id", deckIds);
      if (cardsError) {
        console.error("[ClearData] 删除卡牌失败:", cardsError);
        return NextResponse.json({ error: "清除卡牌数据失败" }, { status: 500 });
      }
    }

    // 删除套牌
    const { error: decksError } = await supabase.from("decks").delete().eq("user_name", userName);
    if (decksError) {
      console.error("[ClearData] 删除套牌失败:", decksError);
      return NextResponse.json({ error: "清除套牌数据失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ClearData]", error);
    return NextResponse.json({ error: "清除数据失败" }, { status: 500 });
  }
}