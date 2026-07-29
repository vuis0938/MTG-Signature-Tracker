import { NextResponse } from "next/server";
import { fetchMountainMageArtists } from "@/lib/mountain-mage";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug") === "1";
  const refresh = searchParams.get("refresh") === "1";

  try {
    const result = await fetchMountainMageArtists(refresh);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "获取 Mountain Mage 数据失败" },
        { status: 502 }
      );
    }

    const response: Record<string, unknown> = {
      success: true,
      sections: result.sections,
      artists: result.artists,
      cached: result.cached,
      stale: result.stale,
    };

    // 调试模式：返回完整原始文本
    if (debug) {
      response.debug = {
        rawText: result.rawText || null,
        rawTextLength: result.rawText?.length || 0,
        sectionCount: result.sections.length,
        parsedCount: result.artists.length,
        sections: result.sections,
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[MountainMage API]", error);
    return NextResponse.json(
      { error: "获取 Mountain Mage 数据失败" },
      { status: 500 }
    );
  }
}