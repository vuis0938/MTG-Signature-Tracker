// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase", () => {
  const mockClient: any = {
    from: vi.fn(() => mockClient),
    select: vi.fn(() => mockClient),
    insert: vi.fn(() => mockClient),
    update: vi.fn(() => mockClient),
    eq: vi.fn(() => mockClient),
    limit: vi.fn(() => mockClient),
    single: vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } })),
  };
  return {
    supabase: mockClient,
    getSupabase: vi.fn(() => mockClient),
  };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60000 })),
  getClientIP: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getUserFromRequest: vi.fn(() => Promise.resolve("alice")),
    revokeTokens: vi.fn(() => Promise.resolve(true)),
  };
});

import { POST } from "../route";
import { getUserFromRequest } from "@/lib/auth";
import { supabase as rawSupabase } from "@/lib/supabase";

const supabase = rawSupabase as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRequest(body: unknown, cookie = "valid-token"): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
    cookies: {
      get: (name: string) => (name === "auth_token" ? { value: cookie } : undefined),
    },
  } as unknown as NextRequest;
}

describe("/api/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOKEN_SECRET", "test-secret-must-be-at-least-32-characters-long");
    vi.mocked(supabase.from).mockReturnValue(supabase as any);
    vi.mocked(supabase.select).mockReturnValue(supabase as any);
    vi.mocked(supabase.insert).mockReturnValue(supabase as any);
    vi.mocked(supabase.update).mockReturnValue(supabase as any);
    vi.mocked(supabase.eq).mockReturnValue(supabase as any);
    vi.mocked(supabase.limit).mockReturnValue(supabase as any);
    vi.mocked(supabase.single).mockResolvedValue({ data: null, error: { code: "PGRST116" } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未登录返回 401", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ oldPassword: "old", newPassword: "new12345" }));
    expect(res.status).toBe(401);
  });

  it("缺少密码返回 400", async () => {
    const res = await POST(makeRequest({ oldPassword: "old" }));
    expect(res.status).toBe(400);
  });

  it("新密码过短返回 400", async () => {
    const res = await POST(makeRequest({ oldPassword: "old", newPassword: "short" }));
    expect(res.status).toBe(400);
  });

  it("新密码与旧密码相同返回 400", async () => {
    const res = await POST(makeRequest({ oldPassword: "same12345", newPassword: "same12345" }));
    expect(res.status).toBe(400);
  });

  it("旧密码错误返回 401", async () => {
    vi.mocked(supabase.single).mockResolvedValueOnce({
      data: { password: "600000:salt:correcthash" },
      error: null,
    });
    const res = await POST(makeRequest({ oldPassword: "wrong", newPassword: "new12345" }));
    expect(res.status).toBe(401);
  });
});
