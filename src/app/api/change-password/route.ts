import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

// 修改密码限流：1 小时内最多 5 次
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000;

// POST: 修改密码（需登录，验证旧密码）
export async function POST(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流
  const ip = getClientIP(request);
  const limit = rateLimit(`change-pwd:${ip}`, MAX_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    const waitMin = Math.ceil((limit.resetAt - Date.now()) / 60000);
    return NextResponse.json(
      { error: `尝试次数过多，请 ${waitMin} 分钟后再试` },
      { status: 429 }
    );
  }

  try {
    const { oldPassword, newPassword } = await request.json();

    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: "请输入旧密码和新密码" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "新密码至少 8 个字符" }, { status: 400 });
    }
    if (newPassword.length > 64) {
      return NextResponse.json({ error: "新密码不能超过 64 个字符" }, { status: 400 });
    }
    if (oldPassword === newPassword) {
      return NextResponse.json({ error: "新密码不能与旧密码相同" }, { status: 400 });
    }

    // 查询当前密码
    const { data: user } = await supabase
      .from("users")
      .select("password")
      .eq("username", userName)
      .single();

    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    // 验证旧密码
    const storedPassword = user.password as string;
    let isValid = false;

    if (storedPassword.includes(":")) {
      isValid = await verifyPassword(oldPassword, storedPassword);
    } else {
      // 兼容旧明文密码
      isValid = storedPassword === oldPassword;
    }

    if (!isValid) {
      return NextResponse.json({ error: "旧密码不正确" }, { status: 401 });
    }

    // 更新密码
    const hashedPassword = await hashPassword(newPassword);
    const { error } = await supabase
      .from("users")
      .update({ password: hashedPassword })
      .eq("username", userName);

    if (error) {
      return NextResponse.json({ error: "修改失败，请重试" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "密码修改成功" });
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
}
