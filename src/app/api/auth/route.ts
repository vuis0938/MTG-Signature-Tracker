import { NextRequest, NextResponse } from "next/server";

// 格式: "用户名:密码, 用户名:密码"
function parseUsers(): Map<string, string> {
  const raw = process.env.SECRET_KEYS || "";
  const map = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const [name, pw] = entry.trim().split(":");
    if (name && pw) map.set(pw, name.trim());
  }
  return map;
}

export async function POST(request: NextRequest) {
  try {
    const { secret } = await request.json();

    if (!secret || typeof secret !== "string") {
      return NextResponse.json({ error: "请提供访问密钥" }, { status: 400 });
    }

    const users = parseUsers();
    const userName = users.get(secret);

    if (!userName) {
      return NextResponse.json({ error: "密钥不正确" }, { status: 401 });
    }

    const response = NextResponse.json({ success: true, user: userName });

    // auth_token: 验证身份
    response.cookies.set("auth_token", secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    // user_name: 数据隔离
    response.cookies.set("user_name", userName, {
      httpOnly: false, // 前端可读
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
}
