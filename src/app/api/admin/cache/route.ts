import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";

// GET: 缓存统计 + 搜索
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));

    // 缓存统计
    const { count: totalCount } = await supabase
      .from("card_printings")
      .select("*", { count: "exact", head: true });

    // 平均年龄（最早和最晚的 created_at）
    const { data: oldest } = await supabase
      .from("card_printings")
      .select("created_at")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    const { data: newest } = await supabase
      .from("card_printings")
      .select("created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    // 搜索或分页列表
    let query = supabase
      .from("card_printings")
      .select("card_name, created_at, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false });

    if (search) {
      query = query.ilike("card_name", `%${search}%`);
    }

    const offset = (page - 1) * pageSize;
    const { data, count } = await query.range(offset, offset + pageSize - 1);

    // 计算每条缓存的印刷版本数和画家数
    const enrichedData = (data || []).map((item) => ({
      ...item,
    }));

    return NextResponse.json({
      success: true,
      stats: {
        totalCached: totalCount ?? 0,
        oldestCreatedAt: oldest?.created_at || null,
        newestUpdatedAt: newest?.updated_at || null,
      },
      items: enrichedData,
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    });
  } catch (err) {
    console.error("[Admin Cache API]", err);
    return NextResponse.json({ error: "获取缓存数据失败" }, { status: 500 });
  }
}

// DELETE: 删除单条缓存或全部清空
export async function DELETE(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const { searchParams } = new URL(request.url);
    const cardName = searchParams.get("cardName");
    const clearAll = searchParams.get("all") === "1";

    const supabase = getSupabase();

    if (clearAll) {
      const { count } = await supabase
        .from("card_printings")
        .select("*", { count: "exact", head: true });

      const { error } = await supabase.from("card_printings").delete().neq("card_name", "___impossible___");

      if (error) {
        return NextResponse.json({ error: "清空缓存失败" }, { status: 500 });
      }

      await logAdminAction(adminName, "cache_clear_all", undefined, { deleted: count ?? 0 });
      return NextResponse.json({ success: true, message: `已清空 ${count ?? 0} 条缓存` });
    }

    if (cardName) {
      const { error } = await supabase
        .from("card_printings")
        .delete()
        .eq("card_name", cardName);

      if (error) {
        return NextResponse.json({ error: "删除失败" }, { status: 500 });
      }

      await logAdminAction(adminName, "cache_delete", cardName);
      return NextResponse.json({ success: true, message: `已删除 ${cardName} 的缓存` });
    }

    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  } catch (err) {
    console.error("[Admin Cache API DELETE]", err);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}
