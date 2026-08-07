// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupFromSequence } from "@/lib/__tests__/supabase-chain-mock";

vi.mock("@/lib/supabase", () => {
  const mockClient: any = {
    from: vi.fn(),
    rpc: vi.fn(),
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

vi.mock("@/lib/touch-deck", () => ({
  touchDeck: vi.fn(() => Promise.resolve()),
  touchDecks: vi.fn(() => Promise.resolve()),
}));

import { GET, PATCH, DELETE } from "../route";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { touchDeck, touchDecks } from "@/lib/touch-deck";

function mockClient() {
  return getSupabase() as any;
}

function makeGet(deckId?: string): NextRequest {
  return {
    nextUrl: {
      searchParams: new URLSearchParams(deckId ? { deckId } : undefined),
    },
  } as unknown as NextRequest;
}

function makeDelete(cardId: string): NextRequest {
  return {
    nextUrl: {
      searchParams: new URLSearchParams({ cardId }),
    },
  } as unknown as NextRequest;
}

function makeJson(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe("/api/cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserFromRequest).mockResolvedValue("alice");
  });

  describe("GET", () => {
    it("未登录返回 401", async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await GET(makeGet("deck-1"));
      expect(res.status).toBe(401);
    });

    it("缺少 deckId 返回 400", async () => {
      const res = await GET(makeGet());
      expect(res.status).toBe(400);
    });

    it("非当前用户的套牌返回 404", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: null, error: { code: "PGRST116" } },
      ]);
      const res = await GET(makeGet("deck-1"));
      expect(res.status).toBe(404);
    });

    it("成功返回当前用户套牌的卡牌列表", async () => {
      const client = mockClient();
      const card = {
        id: "c1",
        deck_id: "deck-1",
        card_name: "Card 1",
        set_code: "set",
        collector_number: "1",
        artist_names: ["Artist"],
        image_url: "",
        status: 0,
        is_signed: false,
        event_name: null,
        event_date: null,
      };
      setupFromSequence(client.from, [
        { data: { id: "deck-1" }, error: null },
        { data: [card], error: null },
      ]);
      const res = await GET(makeGet("deck-1"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.cards).toHaveLength(1);
      expect(json.cards[0].id).toBe("c1");
    });
  });

  describe("PATCH", () => {
    it("缺少卡牌 ID 返回 400", async () => {
      const res = await PATCH(makeJson({ status: 1 }));
      expect(res.status).toBe(400);
    });

    it("无效 status 返回 400", async () => {
      const res = await PATCH(makeJson({ cardId: "c1", status: 99 }));
      expect(res.status).toBe(400);
    });

    it("批量更新成功并刷新套牌时间", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: [{ id: "c1", deck_id: "d1" }, { id: "c2", deck_id: "d1" }], error: null },
        { data: [{ id: "d1" }], error: null },
        { error: null },
      ]);
      const res = await PATCH(
        makeJson({ cardIds: ["c1", "c2"], status: 1 })
      );
      expect(res.status).toBe(200);
      expect(vi.mocked(touchDecks)).toHaveBeenCalledWith(["d1"]);
    });

    it("批量更新时发现部分卡牌不存在返回 404", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: [{ id: "c1", deck_id: "d1" }], error: null },
      ]);
      const res = await PATCH(
        makeJson({ cardIds: ["c1", "c2"], status: 1 })
      );
      expect(res.status).toBe(404);
    });

    it("批量更新时发现无权操作返回 403", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: [{ id: "c1", deck_id: "d1" }, { id: "c2", deck_id: "d1" }], error: null },
        { data: [], error: null },
      ]);
      const res = await PATCH(makeJson({ cardIds: ["c1", "c2"], status: 1 }));
      expect(res.status).toBe(403);
    });

    it("批量更新失败时降级到 RPC 并成功", async () => {
      const client = mockClient();
      vi.mocked(client.rpc).mockResolvedValue({
        data: [{ success: true, error: null }],
        error: null,
      });
      setupFromSequence(client.from, [
        { data: [{ id: "c1", deck_id: "d1" }, { id: "c2", deck_id: "d1" }], error: null },
        { data: [{ id: "d1" }], error: null },
        { error: { message: "batch update failed" } },
      ]);
      const res = await PATCH(makeJson({ cardIds: ["c1", "c2"], status: 2 }));
      expect(res.status).toBe(200);
      expect(client.rpc).toHaveBeenCalledWith(
        "update_card_with_ownership",
        expect.objectContaining({ p_card_id: "c1", p_user_name: "alice" })
      );
      expect(vi.mocked(touchDecks)).toHaveBeenCalledWith(["d1"]);
    });

    it("单卡 RPC 更新成功", async () => {
      const client = mockClient();
      vi.mocked(client.rpc).mockResolvedValue({
        data: [{ success: true, error: null }],
        error: null,
      });
      setupFromSequence(client.from, [
        { data: { deck_id: "d1" }, error: null },
      ]);
      const res = await PATCH(makeJson({ cardId: "c1", status: 1 }));
      expect(res.status).toBe(200);
      expect(vi.mocked(touchDeck)).toHaveBeenCalledWith("d1");
    });

    it("单卡 RPC 返回无权时返回 403", async () => {
      const client = mockClient();
      vi.mocked(client.rpc).mockResolvedValue({
        data: [{ success: false, error: "无权操作此卡牌" }],
        error: null,
      });
      const res = await PATCH(makeJson({ cardId: "c1", status: 1 }));
      expect(res.status).toBe(403);
    });

    it("单卡 RPC 失败后降级到两步查询并成功", async () => {
      const client = mockClient();
      vi.mocked(client.rpc).mockResolvedValue({
        data: null,
        error: { message: "function not found" },
      });
      setupFromSequence(client.from, [
        { data: { id: "c1", deck_id: "d1" }, error: null },
        { data: { id: "d1" }, error: null },
        { error: null },
      ]);
      const res = await PATCH(makeJson({ cardId: "c1", status: 1 }));
      expect(res.status).toBe(200);
      expect(vi.mocked(touchDeck)).toHaveBeenCalledWith("d1");
    });

    it("单卡更新遇到列不存在错误时重试并成功", async () => {
      const client = mockClient();
      vi.mocked(client.rpc).mockResolvedValue({
        data: null,
        error: { message: "function not found" },
      });
      setupFromSequence(client.from, [
        { data: { id: "c1", deck_id: "d1" }, error: null },
        { data: { id: "d1" }, error: null },
        { error: { message: "column event_name does not exist" } },
        { error: null },
      ]);
      const res = await PATCH(
        makeJson({
          cardId: "c1",
          status: 1,
          is_signed: true,
          event_name: "GP",
        })
      );
      expect(res.status).toBe(200);
      expect(vi.mocked(touchDeck)).toHaveBeenCalledWith("d1");
    });
  });

  describe("DELETE", () => {
    it("未登录返回 401", async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await DELETE(makeDelete("c1"));
      expect(res.status).toBe(401);
    });

    it("缺少 cardId 返回 400", async () => {
      const res = await DELETE(makeGet());
      expect(res.status).toBe(400);
    });

    it("卡牌不存在返回 404", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: null, error: { code: "PGRST116" } },
      ]);
      const res = await DELETE(makeDelete("c1"));
      expect(res.status).toBe(404);
    });

    it("非当前用户卡牌返回 403", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: { id: "c1", deck_id: "d1" }, error: null },
        { data: null, error: { code: "PGRST116" } },
      ]);
      const res = await DELETE(makeDelete("c1"));
      expect(res.status).toBe(403);
    });

    it("删除成功后刷新套牌时间", async () => {
      const client = mockClient();
      setupFromSequence(client.from, [
        { data: { id: "c1", deck_id: "d1" }, error: null },
        { data: { id: "d1" }, error: null },
        { error: null },
      ]);
      const res = await DELETE(makeDelete("c1"));
      expect(res.status).toBe(200);
      expect(vi.mocked(touchDeck)).toHaveBeenCalledWith("d1");
    });
  });
});
