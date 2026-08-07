import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword, verifyPassword, createToken, revokeTokens, needsHashUpgrade, isAdmin, hashSecurityAnswer, SECURITY_QUESTIONS } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

// 登录限流：15 分钟内最多 10 次尝试
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// 注册限流：1 小时内最多 5 次
const REGISTER_MAX_ATTEMPTS = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

// Cookie 有效期：7 天（与 Token TTL 一致）
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

async function setCookies(response: NextResponse, request: NextRequest, username: string) {
  const token = await createToken(username);
  if (!token) {
    // 只有在用户不存在时才会失败，理论上登录流程已确认用户存在
    return;
  }
  // 根据实际请求协议决定 secure 标志，避免生产环境通过 HTTP 访问时 cookie 无法写入
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  const isSecure = protocol === "https";
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  response.cookies.set("user_name", username, {
    httpOnly: false,
    secure: isSecure,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  // is_admin 标记供客户端 UI 判断（httpOnly: false）。
  // 安全保障：所有管理员 API 均有服务端 isAdmin() 验证，伪造此 cookie 无法执行任何操作。
  response.cookies.set("is_admin", isAdmin(username) ? "true" : "false", {
    httpOnly: false,
    secure: isSecure,
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
    const limit = await rateLimit(`login:${ip}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
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
      .select("username, password, security_question, security_answer")
      .eq("username", username)
      .limit(1);

    if (!users || users.length === 0) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    const storedPassword = users[0].password as string;
    const isPlaintext = !storedPassword.includes(":");

    // 明文密码（旧数据）：直接比较，验证通过后引导完善账号
    if (isPlaintext) {
      if (password !== storedPassword) {
        return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
      }
      return NextResponse.json({
        needsSetup: true,
        setupReason: "plaintext_password",
        user: username,
      });
    }

    const isValid = await verifyPassword(password, storedPassword);
    if (!isValid) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    // 密码正确但缺少安全问题，引导补充
    if (!users[0].security_question || !users[0].security_answer) {
      return NextResponse.json({
        needsSetup: true,
        setupReason: "missing_security_question",
        user: username,
      });
    }

    // 如果哈希参数过旧，自动升级
    if (needsHashUpgrade(storedPassword)) {
      const hashed = await hashPassword(password);
      await supabase
        .from("users")
        .update({ password: hashed })
        .eq("username", username);
    }

    const response = NextResponse.json({ success: true, user: username });
    await setCookies(response, request, username);

    // 更新最后活跃时间（异步执行，不阻塞响应）
    void (async () => {
      await supabase
        .from("users")
        .update({ last_active_at: new Date().toISOString() })
        .eq("username", username);
    })();

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
    const limit = await rateLimit(`register:${ip}`, REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "操作过于频繁，请稍后再试" },
        { status: 429 }
      );
    }

    const { username, password, securityQuestion, securityAnswer } = await request.json();

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
    // 安全校验：安全问题必填
    if (!securityQuestion || !SECURITY_QUESTIONS.includes(securityQuestion)) {
      return NextResponse.json({ error: "请选择一个安全问题" }, { status: 400 });
    }
    if (!securityAnswer || securityAnswer.trim().length < 1) {
      return NextResponse.json({ error: "请输入安全问题答案" }, { status: 400 });
    }
    if (securityAnswer.trim().length > 100) {
      return NextResponse.json({ error: "安全问题答案不能超过 100 个字符" }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);
    const hashedAnswer = await hashSecurityAnswer(securityAnswer);

    const { error } = await supabase
      .from("users")
      .insert({
        username: username.trim(),
        password: hashedPassword,
        security_question: securityQuestion,
        security_answer: hashedAnswer,
      });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "此用户名已存在" }, { status: 409 });
      }
      return NextResponse.json({ error: "注册失败，请重试" }, { status: 500 });
    }

    const response = NextResponse.json({ success: true, user: username });
    await setCookies(response, request, username);
    return response;
  } catch {
    return NextResponse.json({ error: "服务器异常，请稍后再试" }, { status: 500 });
  }
}

// PATCH: 旧账号首次完善（补充安全问题 / 明文密码升级）
export async function PATCH(request: NextRequest) {
  try {
    // 限流：与登录共用同一窗口
    const ip = getClientIP(request);
    const limit = await rateLimit(`login:${ip}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (!limit.allowed) {
      const waitMin = Math.ceil((limit.resetAt - Date.now()) / 60000);
      return NextResponse.json(
        { error: `尝试次数过多，请 ${waitMin} 分钟后再试` },
        { status: 429 }
      );
    }

    const {
      username,
      currentPassword,
      newPassword,
      securityQuestion,
      securityAnswer,
    } = await request.json();

    if (!username?.trim() || !currentPassword) {
      return NextResponse.json({ error: "请输入用户名和当前密码" }, { status: 400 });
    }

    const trimmed = username.trim();

    const { data: users } = await supabase
      .from("users")
      .select("username, password, security_question, security_answer")
      .eq("username", trimmed)
      .limit(1);

    if (!users || users.length === 0) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    const storedPassword = users[0].password as string;
    const isPlaintext = !storedPassword.includes(":");

    // 验证当前密码
    let passwordValid = false;
    if (isPlaintext) {
      passwordValid = currentPassword === storedPassword;
    } else {
      passwordValid = await verifyPassword(currentPassword, storedPassword);
    }
    if (!passwordValid) {
      return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
    }

    // 明文密码必须升级
    if (isPlaintext && !newPassword) {
      return NextResponse.json({ error: "请设置新密码" }, { status: 400 });
    }

    // 缺少安全问题必须补充
    const hasSecurityQuestion =
      !!users[0].security_question && !!users[0].security_answer;
    if (!hasSecurityQuestion && (!securityQuestion || !securityAnswer)) {
      return NextResponse.json(
        { error: "请设置安全问题及答案" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};

    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json({ error: "新密码至少 8 个字符" }, { status: 400 });
      }
      if (newPassword.length > 64) {
        return NextResponse.json({ error: "新密码不能超过 64 个字符" }, { status: 400 });
      }
      updates.password = await hashPassword(newPassword);
    }

    if (securityQuestion) {
      if (!SECURITY_QUESTIONS.includes(securityQuestion)) {
        return NextResponse.json({ error: "请选择一个安全问题" }, { status: 400 });
      }
      updates.security_question = securityQuestion;
    }

    if (securityAnswer) {
      const trimmedAnswer = securityAnswer.trim();
      if (trimmedAnswer.length < 1) {
        return NextResponse.json({ error: "请输入安全问题答案" }, { status: 400 });
      }
      if (trimmedAnswer.length > 100) {
        return NextResponse.json(
          { error: "安全问题答案不能超过 100 个字符" },
          { status: 400 }
        );
      }
      updates.security_answer = await hashSecurityAnswer(securityAnswer);
    }

    const { error } = await supabase
      .from("users")
      .update(updates)
      .eq("username", trimmed);

    if (error) {
      return NextResponse.json({ error: "更新失败，请重试" }, { status: 500 });
    }

    // 撤销所有旧 token，并签发新 token
    await revokeTokens(trimmed);

    const response = NextResponse.json({ success: true, user: trimmed });
    await setCookies(response, request, trimmed);

    // 更新最后活跃时间（异步执行，不阻塞响应）
    void (async () => {
      await supabase
        .from("users")
        .update({ last_active_at: new Date().toISOString() })
        .eq("username", trimmed);
    })();

    return response;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
}
