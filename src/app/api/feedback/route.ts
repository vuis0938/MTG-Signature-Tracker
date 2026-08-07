import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { requireAdmin, logAdminAction } from "@/lib/admin";
import { rateLimit } from "@/lib/rate-limit";

// 允许的反馈类别
const VALID_CATEGORIES = new Set(["bug", "suggestion", "other"]);

// 内容长度限制
const MAX_CONTENT_LEN = 1000;
const MIN_CONTENT_LEN = 5;

// ─── POST: 用户提交反馈 ─────────────────────────────────────
export async function POST(request: NextRequest) {
  // 鉴权：必须登录
  const userName = await getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：每用户每 10 分钟最多 3 条反馈，防止刷屏
  const limit = await rateLimit(`feedback:${userName}`, 3, 10 * 60 * 1000);
  if (!limit.allowed) {
    const waitMin = Math.ceil((limit.resetAt - Date.now()) / 60000);
    return NextResponse.json(
      { error: `提交过于频繁，请 ${waitMin} 分钟后再试` },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const { category, content } = body as { category?: string; content?: string };

    // 参数校验
    const cat = category || "bug";
    if (!VALID_CATEGORIES.has(cat)) {
      return NextResponse.json({ error: "反馈类别无效" }, { status: 400 });
    }

    if (!content || !content.trim()) {
      return NextResponse.json({ error: "请填写反馈内容" }, { status: 400 });
    }
    if (content.trim().length < MIN_CONTENT_LEN) {
      return NextResponse.json(
        { error: `反馈内容至少 ${MIN_CONTENT_LEN} 个字符` },
        { status: 400 },
      );
    }
    if (content.length > MAX_CONTENT_LEN) {
      return NextResponse.json(
        { error: `反馈内容不能超过 ${MAX_CONTENT_LEN} 个字符` },
        { status: 400 },
      );
    }

    const supabase = getSupabase();
    const { error } = await supabase.from("feedback").insert({
      user_name: userName,
      category: cat,
      content: content.trim(),
      is_read: false,
    });

    if (error) {
      console.error("[Feedback] 插入失败:", error.message);
      throw error;
    }

    return NextResponse.json({ success: true, message: "反馈已提交，感谢您的支持" });
  } catch (error) {
    console.error("[Feedback] POST error:", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// ─── GET: 管理员获取反馈列表 ────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("filter"); // "unread" | "all"

    let query = supabase
      .from("feedback")
      .select("id, user_name, category, content, is_read, created_at")
      .order("is_read", { ascending: true }) // 未读在前
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter === "unread") {
      query = query.eq("is_read", false);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[Feedback] 查询失败:", error.message);
      throw error;
    }

    return NextResponse.json({ success: true, feedback: data || [] });
  } catch (error) {
    console.error("[Feedback] GET error:", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// ─── PATCH: 管理员标记反馈为已读 ────────────────────────────
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const adminUser = auth.userName!;

  try {
    const body = await request.json();
    const { id, ids } = body as { id?: string; ids?: string[] };

    // 支持单条或多条批量标记
    const targetIds = ids && Array.isArray(ids) ? ids : id ? [id] : [];
    if (targetIds.length === 0) {
      return NextResponse.json({ error: "缺少反馈 ID" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from("feedback")
      .update({ is_read: true })
      .in("id", targetIds)
      .eq("is_read", false); // 只更新未读，避免无意义写入

    if (error) {
      console.error("[Feedback] 标记已读失败:", error.message);
      throw error;
    }

    await logAdminAction(adminUser, "feedback_read", `${targetIds.length} 条反馈`);

    return NextResponse.json({ success: true, updated: targetIds.length });
  } catch (error) {
    console.error("[Feedback] PATCH error:", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// ─── DELETE: 管理员删除反馈 ─────────────────────────────────
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const adminUser = auth.userName!;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "缺少反馈 ID" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase.from("feedback").delete().eq("id", id);

    if (error) {
      console.error("[Feedback] 删除失败:", error.message);
      throw error;
    }

    await logAdminAction(adminUser, "feedback_delete", id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Feedback] DELETE error:", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
