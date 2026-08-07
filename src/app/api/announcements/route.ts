import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

// GET: 获取当前生效的公告（所有登录用户可访问）
export async function GET(request: NextRequest) {
  const userName = await getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：高频读取，60 次/分钟
  const ip = getClientIP(request);
  const limit = await rateLimit(`announcements:${ip}`, 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, content, type, created_at")
      .eq("active", true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Announcements API] 查询失败:", error.message);
      return NextResponse.json({ success: true, announcements: [] });
    }

    return NextResponse.json(
      { success: true, announcements: data || [] },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" } }
    );
  } catch (err) {
    console.error("[Announcements API]", err);
    return NextResponse.json(
      { success: true, announcements: [] },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" } }
    );
  }
}
