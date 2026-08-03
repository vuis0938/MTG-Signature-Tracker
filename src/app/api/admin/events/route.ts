import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";

// GET: 自定义活动列表
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("archived") === "1";

    let query = supabase
      .from("events")
      .select("*")
      .eq("source", "manual")
      .order("date", { ascending: false });

    if (!includeArchived) {
      query = query.eq("archived", false);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[Admin Events API] 查询失败:", error.message);
      return NextResponse.json({ error: "获取活动失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true, events: data || [] });
  } catch (err) {
    console.error("[Admin Events API]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// POST: 创建自定义活动
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const body: {
      name: string;
      date: string;
      endDate?: string;
      location?: string;
      artists: string[];
    } = await request.json();

    if (!body.name || !body.date) {
      return NextResponse.json({ error: "活动名称和日期为必填项" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("events")
      .insert({
        name: body.name.trim(),
        date: body.date,
        end_date: body.endDate || null,
        location: body.location?.trim() || null,
        artists: body.artists || [],
        source: "manual",
      })
      .select()
      .single();

    if (error) {
      console.error("[Admin Events API] 创建失败:", error.message);
      return NextResponse.json({ error: "创建失败" }, { status: 500 });
    }

    await logAdminAction(adminName, "event_create", body.name, { date: body.date });
    return NextResponse.json({ success: true, event: data });
  } catch (err) {
    console.error("[Admin Events API POST]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// PATCH: 更新活动（编辑或归档）
export async function PATCH(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const body: {
      id: string;
      name?: string;
      date?: string;
      endDate?: string;
      location?: string;
      artists?: string[];
      archived?: boolean;
    } = await request.json();

    if (!body.id) {
      return NextResponse.json({ error: "缺少活动 ID" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.date !== undefined) updates.date = body.date;
    if (body.endDate !== undefined) updates.end_date = body.endDate || null;
    if (body.location !== undefined) updates.location = body.location?.trim() || null;
    if (body.artists !== undefined) updates.artists = body.artists;
    if (body.archived !== undefined) updates.archived = body.archived;

    const supabase = getSupabase();
    const { error } = await supabase.from("events").update(updates).eq("id", body.id);

    if (error) {
      console.error("[Admin Events API PATCH] 失败:", error.message);
      return NextResponse.json({ error: "更新失败" }, { status: 500 });
    }

    await logAdminAction(adminName, "event_update", body.id, updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Events API PATCH]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// DELETE: 删除活动
export async function DELETE(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少活动 ID" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase.from("events").delete().eq("id", id);

    if (error) {
      console.error("[Admin Events API DELETE] 失败:", error.message);
      return NextResponse.json({ error: "删除失败" }, { status: 500 });
    }

    await logAdminAction(adminName, "event_delete", id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Events API DELETE]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
