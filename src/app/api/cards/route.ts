import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import type { CardEntry } from "@/types";

// GET: 获取指定套牌的卡牌列表
export async function GET(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const deckId = request.nextUrl.searchParams.get("deckId");
    if (!deckId) {
      return NextResponse.json({ error: "缺少套牌 ID" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证套牌属于当前用户
    const { data: deck } = await supabase
      .from("decks")
      .select("id")
      .eq("id", deckId)
      .eq("user_name", userName)
      .single();

    if (!deck) {
      return NextResponse.json({ error: "套牌不存在" }, { status: 404 });
    }

    const { data: cards, error } = await supabase
      .from("cards")
      .select("*")
      .eq("deck_id", deckId)
      .order("artist_names");

    if (error) {
      console.error("[Cards API] 查询失败:", error.message);
      return NextResponse.json({ error: "获取卡牌失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true, cards: (cards || []) as CardEntry[] });
  } catch (error) {
    console.error("[Cards API GET]", error);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}

// PATCH: 更新卡牌状态
export async function PATCH(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { cardId, status, is_signed, event_name, event_date } = body as {
      cardId?: string;
      status?: number;
      is_signed?: boolean;
      event_name?: string | null;
      event_date?: string | null;
    };

    if (!cardId) {
      return NextResponse.json({ error: "缺少卡牌 ID" }, { status: 400 });
    }
    // 校验 status 合法范围
    if (status !== undefined && (![0, 1, 2, 3].includes(status))) {
      return NextResponse.json({ error: "无效的卡牌状态" }, { status: 400 });
    }
    // 校验字符串长度
    if (event_name !== undefined && event_name !== null && event_name.length > 200) {
      return NextResponse.json({ error: "活动名称过长" }, { status: 400 });
    }

    const supabase = getSupabase();

    // ── 快速路径：RPC 函数（单次 DB 往返，归属校验 + UPDATE 原子完成）──
    // 需要先在 Supabase 执行 supabase/migrations/001_optimize_card_toggle.sql
    // 如果 RPC 函数不存在则自动降级到下面的两次查询方式
    if (status !== undefined && is_signed !== undefined) {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "update_card_with_ownership",
        {
          p_card_id: cardId,
          p_user_name: userName,
          p_status: status,
          p_is_signed: is_signed,
          p_event_name: event_name ?? null,
          p_event_date: event_date ?? null,
        }
      );

      // RPC 调用成功
      if (!rpcError && rpcResult && rpcResult.length > 0) {
        const result = rpcResult[0] as { success: boolean; error: string | null };
        if (result.success) {
          return NextResponse.json({ success: true });
        }
        const errStatus = result.error === "卡牌不存在" ? 404 : 403;
        return NextResponse.json(
          { error: result.error || "更新失败" },
          { status: errStatus }
        );
      }
      // RPC 失败（函数不存在等）→ 降级到两次查询方式
    }

    // ── 降级路径：两次 DB 查询（SELECT 归属校验 + UPDATE）──
    const { data: card } = await supabase
      .from("cards")
      .select("id, deck:decks!inner(user_name)")
      .eq("id", cardId)
      .single();

    if (!card) {
      return NextResponse.json({ error: "卡牌不存在" }, { status: 404 });
    }

    const deckOwner = card.deck as unknown as { user_name: string } | null;
    if (!deckOwner || deckOwner.user_name !== userName) {
      return NextResponse.json({ error: "无权操作此卡牌" }, { status: 403 });
    }

    // 构建更新字段
    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (is_signed !== undefined) updates.is_signed = is_signed;
    if (event_name !== undefined) updates.event_name = event_name;
    if (event_date !== undefined) updates.event_date = event_date;

    const { error: updateError } = await supabase
      .from("cards")
      .update(updates)
      .eq("id", cardId);

    if (updateError) {
      console.error("[Cards API] 更新失败:", updateError.message);
      return NextResponse.json({ error: "更新失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Cards API PATCH]", error);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}

// DELETE: 删除卡牌
export async function DELETE(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const cardId = request.nextUrl.searchParams.get("cardId");
    if (!cardId) {
      return NextResponse.json({ error: "缺少卡牌 ID" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证卡牌归属权
    const { data: card } = await supabase
      .from("cards")
      .select("id, deck:decks!inner(user_name)")
      .eq("id", cardId)
      .single();

    if (!card) {
      return NextResponse.json({ error: "卡牌不存在" }, { status: 404 });
    }

    const deckOwner = card.deck as unknown as { user_name: string } | null;
    if (!deckOwner || deckOwner.user_name !== userName) {
      return NextResponse.json({ error: "无权操作此卡牌" }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from("cards")
      .delete()
      .eq("id", cardId);

    if (deleteError) {
      console.error("[Cards API] 删除失败:", deleteError.message);
      return NextResponse.json({ error: "删除失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Cards API DELETE]", error);
    return NextResponse.json({ error: "服务器异常" }, { status: 500 });
  }
}
