import { NextResponse } from "next/server";
import { fetchMountainMageArtists } from "@/lib/mountain-mage";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug") === "1";

  try {
    const result = await fetchMountainMageArtists();

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "获取 Mountain Mage 数据失败" },
        { status: 502 }
      );
    }

    const response: Record<string, unknown> = {
      success: true,
      artists: result.artists,
      cached: result.cached,
      stale: result.stale,
    };

    // 调试模式：返回原始文本前 3000 字符，方便比对解析器准确性
    if (debug) {
      response.debug = {
        rawTextPreview: result.rawText?.slice(0, 3000) || null,
        rawTextLength: result.rawText?.length || 0,
        parsedCount: result.artists.length,
        hint: "对比 rawTextPreview 和 artists，如果解析不准确，把 rawTextPreview 内容发给开发者修正解析器",
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