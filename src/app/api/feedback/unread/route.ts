import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";

// ─── GET: 管理员获取未读反馈数量 ────────────────────────────
// 用于管理后台导航栏角标轮询，返回最小数据量保证响应极快
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("is_read", false);

    if (error) {
      console.error("[Feedback] 未读计数失败:", error.message);
      throw error;
    }

    return NextResponse.json({ success: true, unread: count ?? 0 });
  } catch (error) {
    console.error("[Feedback] unread GET error:", error);
    return NextResponse.json({ success: true, unread: 0 });
  }
}
