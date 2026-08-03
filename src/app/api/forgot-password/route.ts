import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword, verifySecurityAnswer } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

// 忘记密码限流：1 小时内最多 5 次（按 IP）
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000;

// GET: 根据用户名获取安全问题
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");

  if (!username?.trim()) {
    return NextResponse.json({ error: "请输入用户名" }, { status: 400 });
  }

  const { data: user } = await supabase
    .from("users")
    .select("security_question")
    .eq("username", username.trim())
    .single();

  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  if (!user.security_question) {
    return NextResponse.json({ error: "未设置安全问题，请联系管理员" }, { status: 400 });
  }

  return NextResponse.json({ success: true, question: user.security_question });
}

// POST: 验证安全问题答案并重置密码
export async function POST(request: NextRequest) {
  // 限流
  const ip = getClientIP(request);
  const limit = rateLimit(`forgot-pwd:${ip}`, MAX_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    const waitMin = Math.ceil((limit.resetAt - Date.now()) / 60000);
    return NextResponse.json(
      { error: `操作过于频繁，请 ${waitMin} 分钟后再试` },
      { status: 429 }
    );
  }

  try {
    const { username, securityAnswer, newPassword } = await request.json();

    if (!username?.trim() || !securityAnswer?.trim() || !newPassword) {
      return NextResponse.json({ error: "请填写完整信息" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "新密码至少 8 个字符" }, { status: 400 });
    }
    if (newPassword.length > 64) {
      return NextResponse.json({ error: "新密码不能超过 64 个字符" }, { status: 400 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("security_question, security_answer")
      .eq("username", username.trim())
      .single();

    // 用户不存在或未设置安全问题
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
    if (!user.security_answer) {
      return NextResponse.json({ error: "未设置安全问题，请联系管理员" }, { status: 400 });
    }

    // 验证安全问题答案
    const isValid = verifySecurityAnswer(securityAnswer, user.security_answer);
    if (!isValid) {
      return NextResponse.json({ error: "安全问题答案不正确" }, { status: 401 });
    }

    // 验证通过，更新密码
    const hashedPassword = await hashPassword(newPassword);
    const { error } = await supabase
      .from("users")
      .update({ password: hashedPassword })
      .eq("username", username.trim());

    if (error) {
      return NextResponse.json({ error: "重置失败，请重试" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "密码重置成功，请重新登录" });
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
}
