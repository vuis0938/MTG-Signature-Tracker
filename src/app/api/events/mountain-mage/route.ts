import { NextResponse } from "next/server";
import { fetchMountainMageArtists } from "@/lib/mountain-mage";

export async function GET() {
  try {
    const result = await fetchMountainMageArtists();

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "获取 Mountain Mage 数据失败" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      artists: result.artists,
      cached: result.cached,
      stale: result.stale,
    });
  } catch (error) {
    console.error("[MountainMage API]", error);
    return NextResponse.json(
      { error: "获取 Mountain Mage 数据失败" },
      { status: 500 }
    );
  }
}