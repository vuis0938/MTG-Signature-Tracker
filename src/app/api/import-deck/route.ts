import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseMoxfieldFormat, detectFormat } from "@/lib/moxfield-parser";

// ─── API Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, text } = body as { name?: string; text?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "请输入套牌名称" }, { status: 400 });
    }
    if (!text?.trim()) {
      return NextResponse.json({ error: "请粘贴套牌列表内容" }, { status: 400 });
    }

    // ── 解析 ──
    const detectedFormat = detectFormat(text);
    const rows = parseMoxfieldFormat(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "未识别到有效卡牌。支持 Moxfield 的 Copy for Moxfield / Arena / MTGO / Plain Text 格式" },
        { status: 400 }
      );
    }

    const formatLabels: Record<string, string> = {
      moxfield: "Copy for Moxfield",
      arena: "Copy for Arena",
      mtgo: "Copy for MTGO",
      plain: "Copy Plain Text",
      generic: "通用格式",
    };

    // ── 创建套牌 ──
    const userName = request.cookies.get("user_name")?.value || "默认用户";
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ name: name.trim(), source: formatLabels[detectedFormat] || "Copy for Moxfield", user_name: userName })
      .select("id")
      .single();

    if (deckError || !deck) {
      return NextResponse.json({ error: `创建套牌失败: ${deckError?.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deckId: deck.id,
      rows,
      total: rows.length,
    });
  } catch (error) {
    console.error("[Import]", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}