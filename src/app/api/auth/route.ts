import { NextRequest, NextResponse } from "next/server";

// 格式: "用户名:密码, 用户名:密码"
function parseUsers(): Map<string, string> {
  const raw = process.env.SECRET_KEYS || "";
  const map = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const [name, pw] = entry.trim().split(":");
    if (name && pw) map.set(name.trim(), pw.trim());
  }
  return map;
}

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }

    const users = parseUsers();
    const expectedPassword = users.get(username);

    if (!expectedPassword || password !== expectedPassword) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    const response = NextResponse.json({ success: true, user: username });

    // auth_token: 验证身份
    response.cookies.set("auth_token", password, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    // user_name: 数据隔离
    response.cookies.set("user_name", username, {
      httpOnly: false,
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
