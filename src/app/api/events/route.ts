import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getEvents } from "@/lib/events-data";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userName = await getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：聚合数据，60 次/分钟
  const ip = getClientIP(request);
  const limit = await rateLimit(`events:${ip}`, 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const events = await getEvents();

    return NextResponse.json(
      { success: true, events },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" } }
    );
  } catch {
    // 所有数据源均失败时 getEvents() 抛出错误
    // 返回空数组而非错误状态，让前端正常渲染"暂无未来活动"
    // 不缓存此结果，下次请求会重新尝试
    return NextResponse.json(
      { success: true, events: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
