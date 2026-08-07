import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rateLimit, getClientIP } from "@/lib/rate-limit";
import { getUserFromRequest, revokeTokens } from "@/lib/auth";

export async function POST(request: NextRequest) {
  // 限流：10 次/分钟
  const ip = getClientIP(request);
  const limit = await rateLimit(`logout:${ip}`, 10, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  // 撤销当前用户的所有 token（实现服务端登出）
  const userName = await getUserFromRequest(request);
  if (userName) {
    await revokeTokens(userName);
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set("auth_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  response.cookies.set("user_name", "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  response.cookies.set("is_admin", "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return response;
}