import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import { touchDeck, touchDecks } from "@/lib/touch-deck";
import type { CardEntry } from "@/types";

/** 只选渲染所需列，减少网络负载 */
const CARD_SELECT_COLUMNS =
  "id, deck_id, card_name, set_code, collector_number, artist_names, image_url, status, is_signed, event_name, event_date";

// GET: 获取指定套牌的卡牌列表
export async function GET(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：高频读取，60 次/分钟
  const ip = getClientIP(request);
  const limit = rateLimit(`cards:${ip}`, 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
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
      .select(CARD_SELECT_COLUMNS)
      .eq("deck_id", deckId)
      .order("artist_names");

    if (error) {
      console.error("[Cards API] 查询失败:", error.message);
      return NextResponse.json({ error: "获取卡牌失败" }, { status: 500 });
    }

    return NextResponse.json({ success: true, cards: (cards || []) as CardEntry[] });
  } catch (error) {
    console.error("[Cards API GET]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
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
    const { cardId, cardIds: cardIdsRaw, status: rawStatus, is_signed, event_name: rawEventName, event_date: rawEventDate } = body as {
      cardId?: string;
      cardIds?: string[];
      status?: number;
      is_signed?: boolean;
      event_name?: string | null;
      event_date?: string | null;
    };

    // 空字符串统一转为 null，避免数据库写入空字符串
    const event_name = rawEventName && rawEventName.trim() !== "" ? rawEventName : null;
    const event_date = rawEventDate && rawEventDate.trim() !== "" ? rawEventDate : null;

    // 统一为数组并去重：支持单卡（cardId）与批量（cardIds）两种入参
    // 去重防止 .in() 返回行数 < cardIds.length 导致归属校验误判
    const cardIds = [...new Set(cardIdsRaw ?? (cardId ? [cardId] : []))];
    if (cardIds.length === 0) {
      return NextResponse.json({ error: "缺少卡牌 ID" }, { status: 400 });
    }
    if (cardIds.length > 200) {
      return NextResponse.json({ error: "批量操作数量过大" }, { status: 400 });
    }

    // 防御性 status 处理：
    // - null/undefined → 0（部分旧卡牌的 status 可能为 NULL，客户端读取后可能传 null）
    // - NaN/超出范围 → 返回明确错误（包含实际值，方便排查）
    const status = rawStatus ?? 0;
    if (typeof status !== "number" || isNaN(status) || ![0, 1, 2, 3].includes(status)) {
      console.error("[Cards API] 无效 status:", JSON.stringify(rawStatus), "cardIds:", cardIds);
      return NextResponse.json(
        { error: `无效的卡牌状态: ${JSON.stringify(rawStatus)}` },
        { status: 400 }
      );
    }
    // 校验字符串长度
    if (event_name !== null && event_name.length > 200) {
      return NextResponse.json({ error: "活动名称过长" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 更新字段（统一构建，所有路径共用）
    const updates: Record<string, unknown> = {
      status,
      is_signed: is_signed ?? false,
      event_name,
      event_date,
    };

    // ── 批量路径：多张卡牌一次归属校验 + 一次 UPDATE ──
    // 使用两步查询替代 PostgREST join（decks!inner），
    // 因为数据库未定义 cards→decks 外键约束，PostgREST 无法解析 join
    if (cardIds.length > 1) {
      // 步骤1: 查询卡牌获取 deck_id（不使用 join）
      const { data: cards, error: cardsError } = await supabase
        .from("cards")
        .select("id, deck_id")
        .in("id", cardIds);

      if (cardsError) {
        console.error("[Cards API] 批量查询卡牌失败:", cardsError.message, "cardIds:", cardIds);
        return NextResponse.json({ error: "查询卡牌失败: " + cardsError.message }, { status: 500 });
      }
      if (!cards || cards.length === 0) {
        console.error("[Cards API] 批量卡牌不存在, cardIds:", cardIds);
        return NextResponse.json({ error: "卡牌不存在" }, { status: 404 });
      }

      // 检查是否所有卡牌都存在
      const foundIds = new Set(cards.map((c) => c.id));
      const missingIds = cardIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        console.error("[Cards API] 部分卡牌不存在:", missingIds);
        return NextResponse.json({ error: "部分卡牌不存在" }, { status: 404 });
      }

      // 步骤2: 查询这些卡牌所属的套牌是否属于当前用户（不使用 join）
      const deckIds = [...new Set(cards.map((c) => c.deck_id))];
      const { data: ownedDecks, error: decksError } = await supabase
        .from("decks")
        .select("id")
        .in("id", deckIds)
        .eq("user_name", userName);

      if (decksError) {
        console.error("[Cards API] 批量查询套牌归属失败:", decksError.message, "deckIds:", deckIds);
        return NextResponse.json({ error: "查询套牌失败" }, { status: 500 });
      }

      const ownedDeckIds = new Set((ownedDecks || []).map((d) => d.id));
      const unauthorizedDeckIds = deckIds.filter((id) => !ownedDeckIds.has(id));
      if (unauthorizedDeckIds.length > 0) {
        console.error("[Cards API] 无权操作部分套牌:", unauthorizedDeckIds);
        return NextResponse.json({ error: "无权操作部分卡牌" }, { status: 403 });
      }

      // 步骤3: 批量更新
      const { error: batchError } = await supabase
        .from("cards")
        .update(updates)
        .in("id", cardIds);

      if (batchError) {
        console.error("[Cards API] 批量更新失败:", batchError.message, "cardIds:", cardIds, "updates:", updates);
        // 如果更新失败，降级到逐张 RPC 调用
        console.warn("[Cards API] 尝试逐张更新降级...");
        const failedIds: string[] = [];
        for (const cid of cardIds) {
          const { data: rpcResult, error: rpcError } = await supabase.rpc(
            "update_card_with_ownership",
            {
              p_card_id: cid,
              p_user_name: userName,
              p_status: status,
              p_is_signed: is_signed ?? false,
              p_event_name: event_name,
              p_event_date: event_date,
            }
          );
          if (rpcError || !rpcResult || rpcResult.length === 0 || !rpcResult[0].success) {
            failedIds.push(cid);
            console.error("[Cards API] 降级 RPC 失败:", cid, rpcError?.message || rpcResult?.[0]?.error);
          }
        }
        if (failedIds.length === 0) {
          // 降级 RPC 全部成功，也更新套牌时间
          await touchDecks(deckIds);
          return NextResponse.json({ success: true });
        }
        console.error("[Cards API] 降级后仍失败的卡牌:", failedIds);
        return NextResponse.json({ error: "部分卡牌更新失败" }, { status: 500 });
      }

      // 批量更新成功，同步更新套牌时间
      await touchDecks(deckIds);

      return NextResponse.json({ success: true });
    }

    // ── 单卡路径：RPC 函数（单次 DB 往返，归属校验 + UPDATE 原子完成）──
    // RPC 使用原生 SQL，不依赖 PostgREST 的外键 join 解析
    const singleCardId = cardIds[0];
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "update_card_with_ownership",
      {
        p_card_id: singleCardId,
        p_user_name: userName,
        p_status: status,
        p_is_signed: is_signed ?? false,
        p_event_name: event_name,
        p_event_date: event_date,
      }
    );

    if (rpcError) {
      console.warn("[Cards API] RPC 调用失败，降级到两步查询:", rpcError.message);
    }

    // RPC 调用成功
    if (!rpcError && rpcResult && rpcResult.length > 0) {
      const result = rpcResult[0] as { success: boolean; error: string | null };
      if (result.success) {
        // 更新套牌时间：查询卡牌所属 deck_id
        const { data: card } = await supabase
          .from("cards")
          .select("deck_id")
          .eq("id", singleCardId)
          .single();
        if (card) {
          await touchDeck(card.deck_id);
        }
        return NextResponse.json({ success: true });
      }
      console.error("[Cards API] RPC 返回失败:", result.error, "cardId:", singleCardId);
      const errStatus = result.error === "卡牌不存在" ? 404 : 403;
      return NextResponse.json(
        { error: result.error || "更新失败" },
        { status: errStatus }
      );
    }

    // ── 降级路径：两步查询（不使用 PostgREST join）──
    // 步骤1: 查询卡牌获取 deck_id
    const { data: card, error: selectError } = await supabase
      .from("cards")
      .select("id, deck_id")
      .eq("id", singleCardId)
      .single();

    if (selectError || !card) {
      console.error("[Cards API] 查询卡牌失败:", selectError?.message, "cardId:", singleCardId);
      return NextResponse.json({ error: "卡牌不存在" }, { status: 404 });
    }

    // 步骤2: 查询套牌归属
    const { data: deck } = await supabase
      .from("decks")
      .select("id")
      .eq("id", card.deck_id)
      .eq("user_name", userName)
      .single();

    if (!deck) {
      return NextResponse.json({ error: "无权操作此卡牌" }, { status: 403 });
    }

    // 步骤3: 更新
    const { error: updateError } = await supabase
      .from("cards")
      .update(updates)
      .eq("id", singleCardId);

    if (updateError) {
      console.error("[Cards API] 更新失败:", updateError.message, "cardId:", singleCardId, "updates:", updates);
      // 如果是列不存在的错误，尝试只更新 status 和 is_signed
      if (updateError.message.includes("column") || updateError.message.includes("Could not find")) {
        console.warn("[Cards API] 尝试不更新 event_name/event_date 重试...");
        const { error: retryError } = await supabase
          .from("cards")
          .update({ status, is_signed: is_signed ?? false })
          .eq("id", singleCardId);
        if (!retryError) {
          await touchDeck(card.deck_id);
          return NextResponse.json({ success: true });
        }
        console.error("[Cards API] 重试仍失败:", retryError.message);
      }
      return NextResponse.json({ error: "更新失败" }, { status: 500 });
    }

    await touchDeck(card.deck_id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Cards API PATCH]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
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

    // 两步查询验证归属权（不使用 PostgREST join）
    // 步骤1: 查询卡牌获取 deck_id
    const { data: card, error: selectError } = await supabase
      .from("cards")
      .select("id, deck_id")
      .eq("id", cardId)
      .single();

    if (selectError || !card) {
      console.error("[Cards API] 删除-查询卡牌失败:", selectError?.message, "cardId:", cardId);
      return NextResponse.json({ error: "卡牌不存在" }, { status: 404 });
    }

    // 步骤2: 验证套牌归属
    const { data: deck } = await supabase
      .from("decks")
      .select("id")
      .eq("id", card.deck_id)
      .eq("user_name", userName)
      .single();

    if (!deck) {
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

    await touchDeck(card.deck_id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Cards API DELETE]", error);
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
