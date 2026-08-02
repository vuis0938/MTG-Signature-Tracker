import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";

// GET: 画家别名列表
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");

    let query = supabase
      .from("artist_aliases")
      .select("*")
      .order("canonical_name", { ascending: true });

    if (search) {
      // Sanitize: remove characters that could break PostgREST filter syntax
      const safeSearch = search.replace(/[(),\\]/g, " ").trim();
      if (safeSearch) {
        query = query.or(`alias.ilike.%${safeSearch}%,canonical_name.ilike.%${safeSearch}%`);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error("[Admin Artists API] 查询失败:", error.message);
      return NextResponse.json({ error: "获取别名列表失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true, aliases: data || [] });
  } catch (err) {
    console.error("[Admin Artists API]", err);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}

// POST: 添加画家别名
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const body: { alias: string; canonicalName: string } = await request.json();

    if (!body.alias || !body.canonicalName) {
      return NextResponse.json({ error: "别名和标准名称为必填项" }, { status: 400 });
    }

    const alias = body.alias.trim();
    const canonicalName = body.canonicalName.trim();

    if (alias.toLowerCase() === canonicalName.toLowerCase()) {
      return NextResponse.json({ error: "别名不能与标准名称相同" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("artist_aliases")
      .insert({ alias, canonical_name: canonicalName })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "该别名已存在" }, { status: 409 });
      }
      console.error("[Admin Artists API POST] 失败:", error.message);
      return NextResponse.json({ error: "添加失败" }, { status: 500 });
    }

    await logAdminAction(adminName, "artist_alias_add", alias, { canonicalName });
    return NextResponse.json({ success: true, alias: data });
  } catch (err) {
    console.error("[Admin Artists API POST]", err);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}

// DELETE: 删除画家别名
export async function DELETE(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少别名 ID" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase.from("artist_aliases").delete().eq("id", id);

    if (error) {
      console.error("[Admin Artists API DELETE] 失败:", error.message);
      return NextResponse.json({ error: "删除失败" }, { status: 500 });
    }

    await logAdminAction(adminName, "artist_alias_delete", id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Artists API DELETE]", err);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}
