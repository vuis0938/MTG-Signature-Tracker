import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";

// GET: 获取当前生效的公告（所有登录用户可访问）
export async function GET(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
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

    return NextResponse.json({ success: true, announcements: data || [] });
  } catch (err) {
    console.error("[Announcements API]", err);
    return NextResponse.json({ success: true, announcements: [] });
  }
}
