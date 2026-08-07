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
    createToken: vi.fn(() => Promise.resolve("mock-token")),
    revokeTokens: vi.fn(() => Promise.resolve(true)),
    verifyPassword: vi.fn(() => Promise.resolve(true)),
    isAdmin: vi.fn(() => false),
  };
});

import { POST, PUT, PATCH } from "../route";
import { supabase as rawSupabase } from "@/lib/supabase";
import { verifyPassword } from "@/lib/auth";

const supabase = rawSupabase as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe("/api/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOKEN_SECRET", "test-secret-must-be-at-least-32-characters-long");
    vi.stubEnv("ADMIN_USERS", "");
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

  describe("POST 登录", () => {
    it("缺少用户名或密码返回 400", async () => {
      const res = await POST(makeRequest({ username: "alice" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("请输入用户名和密码");
    });

    it("用户不存在返回 401", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({ data: [], error: null });
      const res = await POST(makeRequest({ username: "alice", password: "password123" }));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("用户名或密码不正确");
    });

    it("明文密码错误返回 401", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({
        data: [{ username: "alice", password: "plaintext" }],
        error: null,
      });
      const res = await POST(makeRequest({ username: "alice", password: "wrong" }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("用户名或密码不正确");
    });

    it("明文密码正确返回 needsSetup", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({
        data: [{ username: "alice", password: "plaintext" }],
        error: null,
      });
      const res = await POST(makeRequest({ username: "alice", password: "plaintext" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.needsSetup).toBe(true);
      expect(json.setupReason).toBe("plaintext_password");
      expect(json.user).toBe("alice");
    });

    it("缺少安全问题返回 needsSetup", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({
        data: [{
          username: "alice",
          password: "600000:salt:hash",
          security_question: null,
          security_answer: null,
        }],
        error: null,
      });
      const res = await POST(makeRequest({ username: "alice", password: "password123" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.needsSetup).toBe(true);
      expect(json.setupReason).toBe("missing_security_question");
    });

    it("密码错误返回 401", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({
        data: [{
          username: "alice",
          password: "600000:salt:wronghash",
          security_question: "问题",
          security_answer: "答案",
        }],
        error: null,
      });
      vi.mocked(verifyPassword).mockResolvedValueOnce(false);
      const res = await POST(makeRequest({ username: "alice", password: "wrong" }));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("用户名或密码不正确");
    });
  });

  describe("PUT 注册", () => {
    it("缺少用户名或密码返回 400", async () => {
      const res = await PUT(makeRequest({ username: "alice" }));
      expect(res.status).toBe(400);
    });

    it("用户名格式非法返回 400", async () => {
      const res = await PUT(makeRequest({ username: "ab", password: "password123", securityQuestion: "您入坑时的万智牌系列是？", securityAnswer: "dog" }));
      expect(res.status).toBe(400);
    });

    it("密码过短返回 400", async () => {
      const res = await PUT(makeRequest({ username: "alice", password: "short", securityQuestion: "您入坑时的万智牌系列是？", securityAnswer: "dog" }));
      expect(res.status).toBe(400);
    });

    it("安全问题答案过长返回 400", async () => {
      const res = await PUT(makeRequest({
        username: "alice",
        password: "password123",
        securityQuestion: "您入坑时的万智牌系列是？",
        securityAnswer: "a".repeat(101),
      }));
      expect(res.status).toBe(400);
    });

    it("用户名重复返回 409", async () => {
      vi.mocked(supabase.insert).mockResolvedValueOnce({ error: { code: "23505" } });
      const res = await PUT(makeRequest({
        username: "alice",
        password: "password123",
        securityQuestion: "您入坑时的万智牌系列是？",
        securityAnswer: "dog",
      }));
      expect(res.status).toBe(409);
    });
  });

  describe("PATCH 完善账号", () => {
    it("缺少用户名或当前密码返回 400", async () => {
      const res = await PATCH(makeRequest({ username: "alice" }));
      expect(res.status).toBe(400);
    });

    it("用户不存在返回 401", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({ data: [], error: null });
      const res = await PATCH(makeRequest({
        username: "alice",
        currentPassword: "plaintext",
        newPassword: "newpassword123",
        securityQuestion: "您入坑时的万智牌系列是？",
        securityAnswer: "dog",
      }));
      expect(res.status).toBe(401);
    });

    it("明文密码未提供新密码返回 400", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({
        data: [{ username: "alice", password: "plaintext" }],
        error: null,
      });
      const res = await PATCH(makeRequest({
        username: "alice",
        currentPassword: "plaintext",
        securityQuestion: "您入坑时的万智牌系列是？",
        securityAnswer: "dog",
      }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("请设置新密码");
    });

    it("缺少安全问题未提供安全问题返回 400", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({
        data: [{
          username: "alice",
          password: "600000:salt:hash",
          security_question: null,
          security_answer: null,
        }],
        error: null,
      });
      const res = await PATCH(makeRequest({
        username: "alice",
        currentPassword: "password123",
      }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("请设置安全问题及答案");
    });

    it("明文密码正确且补充信息后登录成功", async () => {
      vi.mocked(supabase.limit).mockResolvedValueOnce({
        data: [{ username: "alice", password: "plaintext" }],
        error: null,
      });
      vi.mocked(supabase.update).mockReturnValueOnce({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      } as any);

      const res = await PATCH(makeRequest({
        username: "alice",
        currentPassword: "plaintext",
        newPassword: "newpassword123",
        securityQuestion: "您入坑时的万智牌系列是？",
        securityAnswer: "dog",
      }));
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    });
  });
});
