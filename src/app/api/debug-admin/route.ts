import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, isAdmin } from "@/lib/auth";

// 临时诊断接口：检查管理员配置是否生效
export async function GET(request: NextRequest) {
  const userName = getUserFromRequest(request);
  if (!userName) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const adminUsersEnv = process.env.ADMIN_USERS;
  const cookieName = request.cookies.get("user_name")?.value;

  return NextResponse.json({
    jwtUser: userName,
    cookieUser: cookieName || "(无 user_name cookie)",
    cookieUserIsAdmin: cookieName ? isAdmin(cookieName) : false,
    adminUsersEnvExists: !!adminUsersEnv,
    adminUsersEnvValue: adminUsersEnv || "(未设置)",
    jwtUserIsAdmin: isAdmin(userName),
    nodeEnv: process.env.NODE_ENV,
  });
}
