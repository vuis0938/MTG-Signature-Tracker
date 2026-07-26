import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ScryfallCard, extractArtists, extractImageUrl } from "@/lib/scryfall";
import { SCRYFALL_UA } from "@/lib/scryfall-client";

export async function POST(request: NextRequest) {
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
      return NextResponse.json(
        { error: `写入失败: ${insertError.message}` },
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
          ? `⚠️ 模糊搜索返回了不同版本 (${data.set_name})，请确认画家是否正确`
          : undefined,
    });
  } catch {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}