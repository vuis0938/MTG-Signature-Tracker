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
    verifySecurityAnswer: vi.fn(() => Promise.resolve(false)),
    revokeTokens: vi.fn(() => Promise.resolve(true)),
  };
});

import { GET, POST } from "../route";
import { supabase as rawSupabase } from "@/lib/supabase";
import { verifySecurityAnswer } from "@/lib/auth";

const supabase = rawSupabase as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeGetRequest(username: string): NextRequest {
  return {
    url: `http://localhost/api/forgot-password?username=${encodeURIComponent(username)}`,
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

function makePostRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe("/api/forgot-password", () => {
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

  describe("GET 安全问题", () => {
    it("缺少用户名返回 400", async () => {
      const res = await GET({ url: "http://localhost/api/forgot-password", headers: new Headers(), cookies: { get: () => undefined } } as unknown as NextRequest);
      expect(res.status).toBe(400);
    });

    it("用户不存在返回 404", async () => {
      const res = await GET(makeGetRequest("nonexistent"));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("用户不存在");
    });

    it("用户存在但未设置安全问题返回 400", async () => {
      vi.mocked(supabase.single).mockResolvedValueOnce({
        data: { security_question: null },
        error: null,
      });
      const res = await GET(makeGetRequest("alice"));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("未设置安全问题");
    });

    it("用户存在返回其设置的安全问题", async () => {
      vi.mocked(supabase.single).mockResolvedValueOnce({
        data: { security_question: "你的宠物名字？" },
        error: null,
      });
      const res = await GET(makeGetRequest("alice"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.question).toBe("你的宠物名字？");
    });
  });

  describe("POST 重置密码", () => {
    it("缺少字段返回 400", async () => {
      const res = await POST(makePostRequest({ username: "alice", securityAnswer: "dog" }));
      expect(res.status).toBe(400);
    });

    it("用户不存在返回 404", async () => {
      const res = await POST(makePostRequest({
        username: "nonexistent",
        securityAnswer: "dog",
        newPassword: "newpassword123",
      }));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("用户不存在");
    });

    it("未设置安全问题返回 400", async () => {
      vi.mocked(supabase.single).mockResolvedValueOnce({
        data: { security_question: "你的宠物名字？", security_answer: null },
        error: null,
      });
      const res = await POST(makePostRequest({
        username: "alice",
        securityAnswer: "dog",
        newPassword: "newpassword123",
      }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("未设置安全问题");
    });

    it("答案错误返回 401", async () => {
      vi.mocked(supabase.single).mockResolvedValueOnce({
        data: { security_question: "你的宠物名字？", security_answer: "hashed-answer" },
        error: null,
      });
      const res = await POST(makePostRequest({
        username: "alice",
        securityAnswer: "wrong",
        newPassword: "newpassword123",
      }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("安全问题答案不正确");
    });

    it("答案正确且更新成功返回 200", async () => {
      vi.mocked(supabase.single).mockResolvedValueOnce({
        data: { security_question: "你的宠物名字？", security_answer: "hashed-answer" },
        error: null,
      });
      vi.mocked(supabase.eq)
        .mockReturnValueOnce(supabase as any)
        .mockResolvedValueOnce({ error: null });
      vi.mocked(verifySecurityAnswer).mockResolvedValueOnce(true);

      const res = await POST(makePostRequest({
        username: "alice",
        securityAnswer: "dog",
        newPassword: "newpassword123",
      }));
      expect(res.status).toBe(200);
      expect((await res.json()).message).toBe("密码重置成功，请使用新密码登录");
    });
  });
});
