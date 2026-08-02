import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import { warmCardPrintingsCache } from "@/lib/cache-printings";

/**
 * POST /api/cache-printings
 * 接收一组去重卡牌名，从 Scryfall 拉取所有印刷版本并写入 card_printings 表
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
    const { cardNames } = body as { cardNames?: string[] };

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
