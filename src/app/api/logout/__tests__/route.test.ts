// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(() => Promise.resolve("alice")),
  revokeTokens: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60000 })),
  getClientIP: vi.fn(() => "127.0.0.1"),
}));

import { POST } from "../route";
import { getUserFromRequest, revokeTokens } from "@/lib/auth";

function makeRequest(): NextRequest {
  return {
    headers: new Headers(),
    cookies: {
      get: (name: string) => (name === "auth_token" ? { value: "valid-token" } : undefined),
    },
  } as unknown as NextRequest;
}

describe("/api/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功登出并清除 cookie", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(revokeTokens).toHaveBeenCalledWith("alice");
  });

  it("未登录时不调用 revokeTokens", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(revokeTokens).not.toHaveBeenCalled();
  });
});
