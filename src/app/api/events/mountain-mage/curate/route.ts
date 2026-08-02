import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import type { NextRequest } from "next/server";

interface CuratedSection {
  name: string;
  deadline: string | null;
  artists: string[];
}

interface TaggedLine {
  index: number;
  text: string;
  tag: string;
  artistName: string;
}

export async function POST(request: NextRequest) {
  // 鉴权：策展是管理操作，必须登录
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body: {
      sections: CuratedSection[];
      taggedLines?: TaggedLine[];
      deadlineOverrides?: Record<number, string>;
    } = await request.json();

    if (!body.sections || !Array.isArray(body.sections)) {
      return NextResponse.json({ error: "无效数据格式" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from("mountain_mage_curated")
      .upsert(
        {
          id: "mountain_mage",
          sections: body.sections,
          tagged_lines: body.taggedLines || [],
          deadline_overrides: body.deadlineOverrides || {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

    if (error) {
      console.error("[Curate API] Supabase 写入失败:", error);
      return NextResponse.json({ error: "保存失败" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      sections: body.sections.length,
      artists: body.sections.reduce((sum, s) => sum + s.artists.length, 0),
    });
  } catch (error) {
    console.error("[Curate API]", error);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}

/** GET: 读取已保存的策展数据（含 taggedLines 用于恢复页面状态） */
export async function GET(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("mountain_mage_curated")
      .select("sections, tagged_lines, deadline_overrides, updated_at")
      .eq("id", "mountain_mage")
      .single();

    if (error || !data) {
      return NextResponse.json({ success: false, message: "无已保存数据" });
    }

    return NextResponse.json({
      success: true,
      sections: data.sections,
      taggedLines: data.tagged_lines,
      deadlineOverrides: data.deadline_overrides,
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error("[Curate API GET]", error);
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }
}