import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import { warmCardPrintingsCache } from "@/lib/cache-printings";

/**
 * POST /api/cache-printings
 *
 * 接收 cardNames 或 deckIds，从 Scryfall 拉取所有印刷版本并写入 card_printings 表。
 * 支持 deckIds 参数，自动展开为卡牌名后再预热。
 */
export async function POST(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：防止 Scryfall API 滥用
  const ip = getClientIP(request);
  const limit = rateLimit(`cache-printings:${ip}`, 5, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const body = await request.json();
    let { cardNames } = body as { cardNames?: string[]; deckIds?: string[] };
    const { deckIds } = body as { cardNames?: string[]; deckIds?: string[] };

    // 支持 deckIds：自动从数据库展开为卡牌名
    if (!cardNames && deckIds && deckIds.length > 0) {
      // 验证套牌属于当前用户
      const { data: ownedDecks } = await supabase
        .from("decks")
        .select("id")
        .in("id", deckIds)
        .eq("user_name", userName);

      if (!ownedDecks || ownedDecks.length === 0) {
        return NextResponse.json({ error: "无权访问这些套牌" }, { status: 403 });
      }

      const validDeckIds = ownedDecks.map((d) => d.id);
      const { data: cards } = await supabase
        .from("cards")
        .select("card_name")
        .in("deck_id", validDeckIds);

      cardNames = [...new Set((cards || []).map((c) => c.card_name))];
    }

    if (!cardNames || cardNames.length === 0) {
      return NextResponse.json({ success: true, cached: 0 });
    }
    if (cardNames.length > 200) {
      return NextResponse.json({ error: "卡牌名数量过多（最多 200 个）" }, { status: 400 });
    }

    const result = await warmCardPrintingsCache(cardNames);

    return NextResponse.json({
      success: true,
      cached: result.cached,
      failed: result.failed,
      total: result.total,
    });
  } catch (error) {
    console.error("[CachePrintings]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}