import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";
import { hashPassword, isAdmin } from "@/lib/auth";
import { randomBytes } from "crypto";

// GET: 用户列表（含统计信息）
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = getSupabase();

    // 并行查询用户、套牌、卡牌（原先串行三次往返）
    const [usersRes, decksRes, deckCardCountsRes] = await Promise.all([
      supabase
        .from("users")
        .select("username, created_at, last_active_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("decks")
        .select("id, user_name"),
      supabase
        .from("cards")
        .select("deck_id")
        .limit(10000),
    ]);

    const { data: users, error: usersError } = usersRes;
    if (usersError) {
      console.error("[Admin Users API] 查询失败:", usersError.message);
      return NextResponse.json({ error: "获取用户列表失败" }, { status: 500 });
    }

    const decks = decksRes.data || [];
    const deckCardCounts = deckCardCountsRes.data || [];

    // 按 deck_id 统计卡牌数
    const cardCountByDeck: Record<string, number> = {};
    (deckCardCounts || []).forEach((c) => {
      if (c.deck_id) {
        cardCountByDeck[c.deck_id] = (cardCountByDeck[c.deck_id] || 0) + 1;
      }
    });

    // 按用户聚合
    const deckCountByUser: Record<string, number> = {};
    const cardCountByUser: Record<string, number> = {};
    (decks || []).forEach((d) => {
      deckCountByUser[d.user_name] = (deckCountByUser[d.user_name] || 0) + 1;
      cardCountByUser[d.user_name] = (cardCountByUser[d.user_name] || 0) + (cardCountByDeck[d.id] || 0);
    });

    const userList = (users || []).map((u) => ({
      username: u.username,
      createdAt: u.created_at,
      lastActiveAt: u.last_active_at,
      deckCount: deckCountByUser[u.username] || 0,
      cardCount: cardCountByUser[u.username] || 0,
    }));

    return NextResponse.json({
      success: true,
      users: userList,
      total: userList.length,
    });
  } catch (err) {
    console.error("[Admin Users API]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// PATCH: 删除用户/重置密码
export async function PATCH(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const body: {
      action: "delete" | "reset_password";
      username: string;
    } = await request.json();

    if (!body.action || !body.username) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }

    // 不能操作自己
    if (body.username === adminName) {
      return NextResponse.json({ error: "不能对自己的账号执行此操作" }, { status: 400 });
    }

    // 不能操作其他管理员
    if (isAdmin(body.username)) {
      return NextResponse.json({ error: "不能对管理员执行此操作" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证目标用户存在
    const { data: targetUser } = await supabase
      .from("users")
      .select("username")
      .eq("username", body.username)
      .single();

    if (!targetUser) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    if (body.action === "delete") {
      // 1. 先获取该用户所有套牌 id，确保级联删除卡牌
      const { data: decks } = await supabase
        .from("decks")
        .select("id")
        .eq("user_name", body.username);
      const deckIds = (decks || []).map((d) => d.id);

      // 2. 删除该用户的所有卡牌（按 user_name 兜底，再按 deck_id 精确清理）
      const { error: cardsByUserError } = await supabase
        .from("cards")
        .delete()
        .eq("user_name", body.username);
      if (cardsByUserError) {
        console.error("[Admin Users API] 删除卡牌失败:", cardsByUserError.message);
        return NextResponse.json({ error: "删除用户卡牌数据失败" }, { status: 500 });
      }

      if (deckIds.length > 0) {
        const { error: cardsByDeckError } = await supabase
          .from("cards")
          .delete()
          .in("deck_id", deckIds);
        if (cardsByDeckError) {
          console.error("[Admin Users API] 级联删除卡牌失败:", cardsByDeckError.message);
          return NextResponse.json({ error: "删除用户卡牌数据失败" }, { status: 500 });
        }
      }

      // 3. 删除套牌
      const { error: decksError } = await supabase
        .from("decks")
        .delete()
        .eq("user_name", body.username);
      if (decksError) {
        console.error("[Admin Users API] 删除套牌失败:", decksError.message);
        return NextResponse.json({ error: "删除用户套牌数据失败" }, { status: 500 });
      }

      // 4. 删除用户账号
      const { error: userError } = await supabase
        .from("users")
        .delete()
        .eq("username", body.username);
      if (userError) {
        console.error("[Admin Users API] 删除用户失败:", userError.message);
        return NextResponse.json({ error: "删除用户失败" }, { status: 500 });
      }

      await logAdminAction(adminName, "user_delete", body.username);
      return NextResponse.json({ success: true, message: `已删除用户 ${body.username}` });
    }

    if (body.action === "reset_password") {
      // 生成随机 12 位临时密码
      const tempPassword = randomBytes(6).toString("base64url").slice(0, 12);
      const hashedPassword = await hashPassword(tempPassword);

      const { error: updateError } = await supabase
        .from("users")
        .update({ password: hashedPassword })
        .eq("username", body.username);

      if (updateError) {
        return NextResponse.json({ error: "重置密码失败" }, { status: 500 });
      }

      await logAdminAction(adminName, "user_reset_password", body.username);
      return NextResponse.json({
        success: true,
        message: `已重置 ${body.username} 的密码`,
        tempPassword,
      });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (err) {
    console.error("[Admin Users API PATCH]", err);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
