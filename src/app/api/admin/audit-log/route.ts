import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";

// GET: 审计日志列表（分页）
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
    const offset = (page - 1) * pageSize;

    const { data, count, error: queryError } = await supabase
      .from("admin_logs")
      .select("id, admin_user, action, target, detail, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) {
      console.error("[Admin Audit Log API] 查询失败:", queryError.message);
      return NextResponse.json({ error: "获取日志失败" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      logs: data || [],
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    });
  } catch (err) {
    console.error("[Admin Audit Log API]", err);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}
