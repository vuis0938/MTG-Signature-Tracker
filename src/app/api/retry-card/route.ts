import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ScryfallCard, extractArtists, extractImageUrl, SCRYFALL_UA, SCRYFALL_BASE_URL } from "@/lib/scryfall-client";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import { touchDeck } from "@/lib/touch-deck";

export async function POST(request: NextRequest) {
  // 鉴权
  const userName = await getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流：外部 API 调用，10 次/分钟
  const ip = getClientIP(request);
  const limit = await rateLimit(`retry-card:${ip}`, 10, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { deckId, cardName, setCode, collectorNumber } = body as {
      deckId?: string;
      cardName?: string;
      setCode?: string;
      collectorNumber?: string;
    };

    if (!deckId || !cardName) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }

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

    // 模糊搜索
    const url = `${SCRYFALL_BASE_URL}/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Scryfall 未找到 "${cardName}"` },
        { status: 404 }
      );
    }

    const data: ScryfallCard = await res.json();
    const artists = extractArtists(data);
    const imageUrl = extractImageUrl(data);

    // 写入数据库
    const { error: insertError } = await supabase.from("cards").insert({
      deck_id: deckId,
      scryfall_id: data.id,
      card_name: data.name,
      set_name: data.set_name,
      set_code: setCode || data.set,
      collector_number: collectorNumber || data.collector_number,
      artist_names: artists,
      image_url: imageUrl,
    });

    if (insertError) {
      console.error("[RetryCard] 写入失败:", insertError.message);
      return NextResponse.json(
        { error: "写入失败" },
        { status: 500 }
      );
    }

    // 更新套牌更新时间
    await touchDeck(deckId);

    return NextResponse.json({
      success: true,
      card: {
        card_name: data.name,
        set_name: data.set_name,
        set_code: setCode || data.set,
        artist_names: artists,
        image_url: imageUrl,
      },
      note:
        data.set !== setCode?.toLowerCase()
          ? `搜索返回了不同版本 (${data.set_name})，请核对`
          : undefined,
    });
  } catch {
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}