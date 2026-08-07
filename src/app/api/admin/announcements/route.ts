import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";

// GET: 公告列表（管理后台，含未激活的）
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Admin Announcements API] 查询失败:", error.message);
      return NextResponse.json({ error: "获取公告失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true, announcements: data || [] });
  } catch (err) {
    console.error("[Admin Announcements API]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// POST: 创建公告
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const body: {
      title: string;
      content: string;
      type?: string;
      active?: boolean;
      expiresAt?: string | null;
    } = await request.json();

    if (!body.title?.trim() || !body.content?.trim()) {
      return NextResponse.json({ error: "标题和内容为必填项" }, { status: 400 });
    }

    const validTypes = ["info", "warning", "maintenance"];
    const type = validTypes.includes(body.type || "") ? body.type! : "info";

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("announcements")
      .insert({
        title: body.title.trim(),
        content: body.content.trim(),
        type,
        active: body.active !== undefined ? body.active : true,
        expires_at: body.expiresAt || null,
      })
      .select()
      .single();

    if (error) {
      console.error("[Admin Announcements API POST] 失败:", error.message);
      return NextResponse.json({ error: "创建失败" }, { status: 500 });
    }

    await logAdminAction(adminName, "announcement_create", body.title.trim());
    return NextResponse.json({ success: true, announcement: data });
  } catch (err) {
    console.error("[Admin Announcements API POST]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// PATCH: 更新公告
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const body: {
      id: string;
      title?: string;
      content?: string;
      type?: string;
      active?: boolean;
      expiresAt?: string | null;
    } = await request.json();

    if (!body.id) {
      return NextResponse.json({ error: "缺少公告 ID" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.content !== undefined) updates.content = body.content.trim();
    if (body.type !== undefined) {
      const validTypes = ["info", "warning", "maintenance"];
      if (validTypes.includes(body.type)) updates.type = body.type;
    }
    if (body.active !== undefined) updates.active = body.active;
    if (body.expiresAt !== undefined) updates.expires_at = body.expiresAt || null;

    const supabase = getSupabase();
    const { error } = await supabase.from("announcements").update(updates).eq("id", body.id);

    if (error) {
      console.error("[Admin Announcements API PATCH] 失败:", error.message);
      return NextResponse.json({ error: "更新失败" }, { status: 500 });
    }

    await logAdminAction(adminName, "announcement_update", body.id, updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Announcements API PATCH]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// DELETE: 删除公告
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少公告 ID" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase.from("announcements").delete().eq("id", id);

    if (error) {
      console.error("[Admin Announcements API DELETE] 失败:", error.message);
      return NextResponse.json({ error: "删除失败" }, { status: 500 });
    }

    await logAdminAction(adminName, "announcement_delete", id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Announcements API DELETE]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
