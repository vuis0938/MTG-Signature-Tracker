// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: "next" })),
    redirect: vi.fn((url: string) => ({ type: "redirect", url })),
  },
}));

vi.mock("@/lib/auth-edge", () => ({
  verifyToken: vi.fn(),
  isAdmin: vi.fn(),
}));

import { middleware } from "./middleware";
import { verifyToken, isAdmin } from "@/lib/auth-edge";
import { NextResponse } from "next/server";

const nextMock = vi.mocked(NextResponse.next);
const redirectMock = vi.mocked(NextResponse.redirect);

function makeRequest(pathname: string, token?: string): NextRequest {
  return {
    nextUrl: { pathname },
    url: `http://localhost${pathname}`,
    cookies: {
      get: vi.fn((name: string) =>
        name === "auth_token" ? { value: token } : undefined
      ),
    },
  } as unknown as NextRequest;
}

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("公开路径 /login 直接放行", async () => {
    await middleware(makeRequest("/login"));
    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("公开路径 /api/auth 直接放行", async () => {
    await middleware(makeRequest("/api/auth"));
    expect(nextMock).toHaveBeenCalledTimes(1);
  });

  it("静态资源直接放行", async () => {
    await middleware(makeRequest("/_next/static/chunk.js"));
    await middleware(makeRequest("/favicon.ico"));
    await middleware(makeRequest("/logo.png"));
    expect(nextMock).toHaveBeenCalledTimes(3);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("SEO 与法律页面未登录也可访问", async () => {
    const paths = ["/robots.txt", "/sitemap.xml", "/privacy", "/terms", "/site.webmanifest"];
    for (const path of paths) {
      await middleware(makeRequest(path));
    }
    expect(nextMock).toHaveBeenCalledTimes(paths.length);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("未登录访问 /decks 重定向到 /login", async () => {
    vi.mocked(verifyToken).mockResolvedValue(null);
    await middleware(makeRequest("/decks"));
    expect(redirectMock).toHaveBeenCalledTimes(1);
    const url = redirectMock.mock.calls[0][0] as URL;
    expect(url.href).toBe("http://localhost/login");
    expect(nextMock).not.toHaveBeenCalled();
  });

  it("已登录访问 /decks 放行", async () => {
    vi.mocked(verifyToken).mockResolvedValue("testuser");
    await middleware(makeRequest("/decks", "valid-token"));
    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("非管理员访问 /admin 重定向到 /decks", async () => {
    vi.mocked(verifyToken).mockResolvedValue("testuser");
    vi.mocked(isAdmin).mockReturnValue(false);
    await middleware(makeRequest("/admin", "valid-token"));
    expect(redirectMock).toHaveBeenCalledTimes(1);
    const url = redirectMock.mock.calls[0][0] as URL;
    expect(url.href).toBe("http://localhost/decks");
  });

  it("管理员访问 /admin 放行", async () => {
    vi.mocked(verifyToken).mockResolvedValue("adminuser");
    vi.mocked(isAdmin).mockReturnValue(true);
    await middleware(makeRequest("/admin", "admin-token"));
    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
