import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

interface CuratedSection {
  name: string;
  deadline: string | null;
  artists: string[];
}

export async function POST(request: Request) {
  try {
    const body: { sections: CuratedSection[] } = await request.json();

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