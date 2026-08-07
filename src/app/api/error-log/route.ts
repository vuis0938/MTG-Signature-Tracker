import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rate-limit";

/**
 * 轻量错误日志上报
 *
 * 将客户端未捕获异常写入 feedback 表（category='error'），
 * 管理员可在后台反馈管理页面查看。无需额外建表或第三方服务。
 *
 * 限流：每 IP 每分钟 5 条，防止异常雪崩灌爆数据库。
 */
export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const limit = rateLimit(`error-log:${ip}`, 5, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ success: false }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { message, stack, url, userAgent } = body as {
      message?: string;
      stack?: string;
      url?: string;
      userAgent?: string;
    };

    if (!message || message.length > 2000) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    // 尝试提取用户名（未登录也不阻断上报）
    const userName = getUserFromRequest(request) || "anonymous";

    // 组装错误内容
    const parts = [message];
    if (url) parts.push(`\nURL: ${url}`);
    if (userAgent) parts.push(`\nUA: ${userAgent.slice(0, 200)}`);
    if (stack) parts.push(`\n\nStack:\n${stack.slice(0, 2000)}`);

    await supabase.from("feedback").insert({
      user_name: userName,
      category: "error",
      content: parts.join(""),
      is_read: false,
    });

    return NextResponse.json({ success: true });
  } catch {
    // 上报失败本身不能再抛错，静默处理
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
