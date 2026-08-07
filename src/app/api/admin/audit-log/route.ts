import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";

// GET: 审计日志列表（分页 + 筛选）
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
    const offset = (page - 1) * pageSize;

    // 筛选参数
    const actionFilter = searchParams.get("action");
    const adminFilter = searchParams.get("admin");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    let query = supabase
      .from("admin_logs")
      .select("id, admin_user, action, target, detail, created_at", { count: "exact" })
      .order("created_at", { ascending: false });

    if (actionFilter) {
      query = query.eq("action", actionFilter);
    }
    if (adminFilter) {
      query = query.eq("admin_user", adminFilter);
    }
    if (startDate) {
      query = query.gte("created_at", `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query = query.lte("created_at", `${endDate}T23:59:59.999Z`);
    }

    // 并行查询：分页日志 + 管理员列表（原先串行，且管理员列表全表扫描）
    const [logsResult, adminUsersResult] = await Promise.all([
      query.range(offset, offset + pageSize - 1),
      // 只取最近的记录去重，避免全表扫描
      supabase
        .from("admin_logs")
        .select("admin_user")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const { data, count, error: queryError } = logsResult;

    if (queryError) {
      console.error("[Admin Audit Log API] 查询失败:", queryError.message);
      return NextResponse.json({ error: "获取日志失败" }, { status: 500 });
    }

    const uniqueAdmins = [...new Set((adminUsersResult.data || []).map((a) => a.admin_user))].sort();

    return NextResponse.json({
      success: true,
      logs: data || [],
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
      adminUsers: uniqueAdmins,
    });
  } catch (err) {
    console.error("[Admin Audit Log API]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
