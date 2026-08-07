import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, isAdmin } from "@/lib/auth-edge";

// 不需要鉴权的路由（精确匹配）
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/privacy",
  "/terms",
  "/robots.txt",
  "/sitemap.xml",
  "/site.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/api/auth",
  "/api/forgot-password", // 密码重置：未登录用户使用
  "/api/error-log", // 客户端错误上报：未登录场景也需可用
];

export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  // 强制 canonical 域名：mtgkit.top -> www.mtgkit.top（308 永久重定向）
  const canonicalHost = "www.mtgkit.top";
  if (hostname && hostname.toLowerCase() === "mtgkit.top") {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.hostname = canonicalHost;
    return NextResponse.redirect(canonicalUrl, 308);
  }

  // 公开路由直接放行（精确匹配，避免 /api/auth-xxx 误匹配）
  if (PUBLIC_PATHS.includes(pathname)) {
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

  // 校验 auth_token 签名有效性（HMAC-SHA256），伪造或篡改的 token 拒绝访问
  const token = request.cookies.get("auth_token")?.value;
  const userName = await verifyToken(token);
  if (!userName) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // 管理后台路由：非管理员重定向到主站（纵深防御层）
  if (pathname.startsWith("/admin") && !isAdmin(userName)) {
    const decksUrl = new URL("/decks", request.url);
    return NextResponse.redirect(decksUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，除了:
     * /_next (内部路由)
     * /favicon.ico (图标)
     * 带静态资源扩展名的请求（图片/字体/样式等）— 不进入 middleware，
     * 避免每个静态请求都触发一次边缘函数调用
     */
    "/((?!_next|favicon.ico|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|map|woff2?|ttf|otf)$).*)",
  ],
};
