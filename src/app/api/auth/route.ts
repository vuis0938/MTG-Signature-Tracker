import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function setCookies(response: NextResponse, username: string, password: string) {
  response.cookies.set("auth_token", password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  response.cookies.set("user_name", username, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

// POST: 登录
export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }

    const { data: users } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .limit(1);

    if (!users || users.length === 0) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    if (users[0].password !== password) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    const response = NextResponse.json({ success: true, user: username });
    setCookies(response, username, password);
    return response;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
}

// PUT: 注册
export async function PUT(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }
    if (username.length < 2 || username.length > 30) {
      return NextResponse.json({ error: "用户名需 2-30 个字符" }, { status: 400 });
    }
    if (password.length < 4) {
      return NextResponse.json({ error: "密码至少 4 个字符" }, { status: 400 });
    }

    const { error } = await supabase
      .from("users")
      .insert({ username: username.trim(), password });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "该用户名已被注册" }, { status: 409 });
      }
      return NextResponse.json({ error: "注册失败，请重试" }, { status: 500 });
    }

    const response = NextResponse.json({ success: true, user: username });
    setCookies(response, username, password);
    return response;
  } catch {
    return NextResponse.json({ error: "服务器异常，请稍后重试" }, { status: 500 });
  }
}
