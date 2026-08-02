import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getEvents } from "@/lib/events-data";

export async function GET(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const events = await getEvents();

  return NextResponse.json(
    { success: true, events },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" } }
  );
}
