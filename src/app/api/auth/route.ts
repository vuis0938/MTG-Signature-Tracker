import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { secret } = await request.json();

    if (!secret || typeof secret !== "string") {
      return NextResponse.json(
        { error: "请提供访问密钥" },
        { status: 400 }
      );
    }

    if (secret !== process.env.SECRET_KEY) {
      return NextResponse.json(
        { error: "密钥不正确" },
        { status: 401 }
      );
    }

    // 设置 cookie，有效期一年
    const response = NextResponse.json({ success: true });
    response.cookies.set("auth_token", secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 一年
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "请求格式错误" },
      { status: 400 }
    );
  }
}
