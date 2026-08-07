// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupFromSequence } from "@/lib/__tests__/supabase-chain-mock";

vi.mock("@/lib/supabase", () => {
  const mockClient: any = {
    from: vi.fn(),
  };
  return {
    getSupabase: vi.fn(() => mockClient),
    supabase: mockClient,
  };
});

vi.mock("@/lib/auth-edge", () => ({}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 10, resetAt: Date.now() + 60000 })
  ),
  getClientIP: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(() => Promise.resolve("alice")),
}));

import { GET, DELETE } from "../route";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";

function mockClient() {
  return getSupabase() as any;
}

function makeRequest(deckId?: string): NextRequest {
  return {
    nextUrl: {
      searchParams: new URLSearchParams(deckId ? { deckId } : undefined),
    },
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe("/api/decks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserFromRequest).mockResolvedValue("alice");
  });

  describe("GET", () => {
    it("未登录返回 401", async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
    });

    it("无套牌时返回空列表和空统计", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [{ data: [], error: null }]);
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ success: true, decks: [], stats: {} });
    });

    it("正确聚合多套牌的统计", async () => {
      const client = mockClient();
      const decks = [
        { id: "d1", name: "Deck 1", source: "plain", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" },
        { id: "d2", name: "Deck 2", source: "moxfield", created_at: "2024-01-02T00:00:00Z", updated_at: "2024-01-02T00:00:00Z" },
      ];
      const cards = [
        { deck_id: "d1", status: 0 },
        { deck_id: "d1", status: 1 },
        { deck_id: "d1", status: 2 },
        { deck_id: "d1", status: 3 },
        { deck_id: "d2", status: 0 },
        { deck_id: "d2", status: 3 },
      ];
      setupFromSequence(client.from, [
        { data: decks, error: null },
        { data: cards, error: null },
      ]);
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.decks).toHaveLength(2);
      expect(json.stats).toEqual({
        d1: { total: 4, unsigned: 2, pending: 1, heart: 1 },
        d2: { total: 2, unsigned: 2, pending: 0, heart: 1 },
      });
    });

    it("套牌查询失败返回 500", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: null, error: { message: "database error" } },
      ]);
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE", () => {
    it("未登录返回 401", async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await DELETE(makeRequest("d1"));
      expect(res.status).toBe(401);
    });

    it("缺少 deckId 返回 400", async () => {
      const res = await DELETE(makeRequest());
      expect(res.status).toBe(400);
    });

    it("越权删除返回 404", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: null, error: { code: "PGRST116" } },
      ]);
      const res = await DELETE(makeRequest("d1"));
      expect(res.status).toBe(404);
    });

    it("级联删除卡牌与套牌成功", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: { id: "d1" }, error: null },
        { error: null },
        { error: null },
      ]);
      const res = await DELETE(makeRequest("d1"));
      expect(res.status).toBe(200);
      expect(client.from).toHaveBeenCalledWith("cards");
      expect(client.from).toHaveBeenCalledWith("decks");
    });

    it("套牌删除失败返回 500", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: { id: "d1" }, error: null },
        { error: null },
        { error: { message: "delete failed" } },
      ]);
      const res = await DELETE(makeRequest("d1"));
      expect(res.status).toBe(500);
    });
  });
});
