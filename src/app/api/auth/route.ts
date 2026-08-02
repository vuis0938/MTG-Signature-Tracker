import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword, verifyPassword, createToken, needsHashUpgrade } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

// 登录限流：15 分钟内最多 10 次尝试
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// 注册限流：1 小时内最多 5 次
const REGISTER_MAX_ATTEMPTS = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

// Cookie 有效期：7 天（与 Token TTL 一致）
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

function setCookies(response: NextResponse, username: string) {
  const token = createToken(username);
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  response.cookies.set("user_name", username, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

// POST: 登录
export async function POST(request: NextRequest) {
  try {
    // 限流：防止暴力破解
    const ip = getClientIP(request);
    const limit = rateLimit(`login:${ip}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (!limit.allowed) {
      const waitMin = Math.ceil((limit.resetAt - Date.now()) / 60000);
      return NextResponse.json(
        { error: `尝试次数过多，请 ${waitMin} 分钟后再试` },
        { status: 429 }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }

    const { data: users } = await supabase
      .from("users")
      .select("username, password")
      .eq("username", username)
      .limit(1);

    if (!users || users.length === 0) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    // 兼容旧明文密码：如果存储的密码不含 ":" 分隔符，说明是旧明文密码
    // 验证成功后自动升级为哈希
    const storedPassword = users[0].password as string;
    let isValid = false;

    if (storedPassword.includes(":")) {
      // 哈希格式（新 iterations:salt:hash 或旧 salt:hash）
      isValid = verifyPassword(password, storedPassword);
      // 如果哈希参数过旧，自动升级
      if (isValid && needsHashUpgrade(storedPassword)) {
        const hashed = hashPassword(password);
        await supabase
          .from("users")
          .update({ password: hashed })
          .eq("username", username);
      }
    } else {
      // 旧格式：明文密码（兼容已注册用户）
      isValid = storedPassword === password;
      // 自动升级为哈希
      if (isValid) {
        const hashed = hashPassword(password);
        await supabase
          .from("users")
          .update({ password: hashed })
          .eq("username", username);
      }
    }

    if (!isValid) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    const response = NextResponse.json({ success: true, user: username });
    setCookies(response, username);
    return response;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
}

// PUT: 注册
export async function PUT(request: NextRequest) {
  try {
    // 限流：防止批量注册
    const ip = getClientIP(request);
    const limit = rateLimit(`register:${ip}`, REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "注册过于频繁，请稍后再试" },
        { status: 429 }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }
    if (username.length < 4 || username.length > 30) {
      return NextResponse.json({ error: "用户名需 4-30 个字符" }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9]+$/.test(username)) {
      return NextResponse.json({ error: "用户名只能包含字母和数字" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "密码至少 8 个字符" }, { status: 400 });
    }
    if (password.length > 64) {
      return NextResponse.json({ error: "密码不能超过 64 个字符" }, { status: 400 });
    }

    const hashedPassword = hashPassword(password);

    const { error } = await supabase
      .from("users")
      .insert({ username: username.trim(), password: hashedPassword });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "该用户名已被注册" }, { status: 409 });
      }
      return NextResponse.json({ error: "注册失败，请重试" }, { status: 500 });
    }

    const response = NextResponse.json({ success: true, user: username });
    setCookies(response, username);
    return response;
  } catch {
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}
