import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ScryfallCard, extractArtists, extractImageUrl } from "@/lib/scryfall-client";
import { SCRYFALL_UA } from "@/lib/scryfall-client";
import { getUserFromRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
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
    const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
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