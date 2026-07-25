import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractArtists, extractImageUrl, ScryfallCard } from "@/lib/scryfall";

const SCRYFALL_UA = "MTG-Signature-Tracker/1.0";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cardId, setCode, collectorNumber } = body as {
      cardId?: string;
      setCode?: string;
      collectorNumber?: string;
    };

    if (!cardId?.trim()) {
      return NextResponse.json({ error: "缺少卡牌 ID" }, { status: 400 });
    }
    if (!setCode?.trim() || !collectorNumber?.trim()) {
      return NextResponse.json({ error: "缺少 set_code 或 collector_number" }, { status: 400 });
    }

    // 查询当前卡牌数据
    const { data: existingCard, error: cardError } = await supabase
      .from("cards")
      .select("*")
      .eq("id", cardId)
      .single();

    if (cardError || !existingCard) {
      return NextResponse.json({ error: "卡牌不存在" }, { status: 404 });
    }

    // 从 Scryfall 获取新印刷版本
    const url = `https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": SCRYFALL_UA, Accept: "application/json" },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json(
          { error: `未找到 ${setCode}/${collectorNumber} 对应的卡牌` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Scryfall 查询失败 (HTTP ${res.status})` },
        { status: 502 }
      );
    }

    const scryfallCard = (await res.json()) as ScryfallCard;

    // 更新数据库
    const updates: Record<string, unknown> = {
      scryfall_id: scryfallCard.id,
      set_name: scryfallCard.set_name,
      set_code: setCode,
      collector_number: collectorNumber,
      artist_names: extractArtists(scryfallCard),
      image_url: extractImageUrl(scryfallCard),
    };

    const { error: updateError } = await supabase
      .from("cards")
      .update(updates)
      .eq("id", cardId);

    if (updateError) {
      return NextResponse.json(
        { error: `数据库更新失败: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      cardId,
      cardName: scryfallCard.name,
      newSet: scryfallCard.set_name,
      newSetCode: setCode,
      newCollectorNumber: collectorNumber,
      newArtistNames: extractArtists(scryfallCard),
      newImageUrl: extractImageUrl(scryfallCard),
    });
  } catch (error) {
    console.error("[SwitchPrinting]", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}