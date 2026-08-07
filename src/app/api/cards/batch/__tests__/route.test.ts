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

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(() => Promise.resolve("alice")),
}));

import { POST } from "../route";
import { getSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";

function mockClient() {
  return getSupabase() as any;
}

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe("/api/cards/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserFromRequest).mockResolvedValue("alice");
  });

  it("未登录返回 401", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(401);
  });

  it("缺少 deckIds 返回 400", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("deckIds 超过 50 个返回 400", async () => {
    const res = await POST(makeRequest({ deckIds: Array(51).fill("d") }));
    expect(res.status).toBe(400);
  });

  it("所有套牌均不归属当前用户时返回 403", async () => {
    const client = mockClient();
    setupFromSequence(client.from, [{ data: [], error: null }]);
    const res = await POST(makeRequest({ deckIds: ["d1", "d2"] }));
    expect(res.status).toBe(403);
  });

  it("合并多个 deckId 并过滤未授权的套牌", async () => {
    const client = mockClient();
    const ownedDecks = [
      { id: "d1", name: "Deck One" },
      { id: "d2", name: "Deck Two" },
    ];
    const cards = [
      { id: "c1", deck_id: "d1", card_name: "Card 1", artist_names: ["A"], status: 0 },
      { id: "c2", deck_id: "d2", card_name: "Card 2", artist_names: ["B"], status: 1 },
      { id: "c3", deck_id: "d2", card_name: "Card 3", artist_names: ["C"], status: 3 },
    ];
    setupFromSequence(client.from, [
      { data: ownedDecks, error: null },
      { data: cards, error: null },
    ]);
    const res = await POST(makeRequest({ deckIds: ["d1", "d2", "d3"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBe(3);
    expect(json.cards.map((c: any) => c.deck_name)).toEqual([
      "Deck One",
      "Deck Two",
      "Deck Two",
    ]);
  });

  it("卡牌查询失败返回 500", async () => {
    const client = mockClient();
    setupFromSequence(client.from, [
      { data: [{ id: "d1", name: "Deck One" }], error: null },
      { data: null, error: { message: "cards query failed" } },
    ]);
    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(500);
  });
});
