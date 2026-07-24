import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 不需要鉴权的路由
const PUBLIC_PATHS = ["/login", "/api/auth"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路由直接放行
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 静态资源和内部路由放行
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.match(/\.(svg|png|jpg|ico|css|js)$/)
  ) {
    return NextResponse.next();
  }

  // 检查 auth_token cookie（登录 API 已验证过密码）
  if (!request.cookies.get("auth_token")?.value) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，除了:
     * /_next (内部路由)
     * /favicon.ico (图标)
     */
    "/((?!_next|favicon.ico).*)",
  ],
};
