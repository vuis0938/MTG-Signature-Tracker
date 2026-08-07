import { NextRequest, NextResponse } from "next/server";
import { fetchMountainMageArtists } from "@/lib/mountain-mage";
import { getUserFromRequest, isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 鉴权
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "1";
  // 仅管理员可获取原始文本（用于策展页面）
  const includeRaw = searchParams.get("raw") === "1" && isAdmin(userName);

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

    // 仅管理员可获取原始文本
    if (includeRaw) {
      response.rawText = result.rawText || null;
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