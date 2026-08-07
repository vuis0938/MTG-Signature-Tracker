// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockDb = vi.hoisted(() => {
  let decks: any[] = [];
  let cards: any[] = [];
  let printings: any[] = [];
  return {
    setData: (d: { decks?: any[]; cards?: any[]; printings?: any[] } = {}) => {
      decks = d.decks ?? [];
      cards = d.cards ?? [];
      printings = d.printings ?? [];
    },
    getDecks: () => decks,
    getCards: () => cards,
    getPrintings: () => printings,
  };
});

vi.mock("@/lib/supabase", () => {
  function chain(table: string): any {
    const c: any = {
      table,
      from: vi.fn((t: string) => chain(t)),
      select: vi.fn(() => c),
      insert: vi.fn(() => c),
      update: vi.fn(() => c),
      limit: vi.fn(() => c),
      single: vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      in: vi.fn(() => (table === "decks" ? c : Promise.resolve({
        data: table === "cards" ? mockDb.getCards() : mockDb.getPrintings(),
        error: null,
      }))),
      eq: vi.fn(() => (table === "decks"
        ? Promise.resolve({ data: mockDb.getDecks(), error: null })
        : c)),
    };
    return c;
  }
  const mockClient = chain("");
  return {
    supabase: mockClient,
    getSupabase: vi.fn(() => mockClient),
    setSupabaseTestData: mockDb.setData,
  };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60000 })),
  getClientIP: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(() => Promise.resolve("alice")),
}));

vi.mock("@/lib/scryfall-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scryfall-client")>("@/lib/scryfall-client");
  return {
    ...actual,
    fetchAllPrintings: vi.fn(),
    delay: vi.fn(() => Promise.resolve()),
  };
});

import { POST } from "../route";
import { getUserFromRequest } from "@/lib/auth";
import { fetchAllPrintings } from "@/lib/scryfall-client";

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

function makePrinting(name: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    artist: "John Avon",
    set: "TST",
    set_name: "Test Set",
    collector_number: "1",
    image_url: "https://example.com/card.jpg",
    released_at: "2024-01-01",
    ...overrides,
  };
}

describe("/api/fuzzy-match", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOKEN_SECRET", "test-secret-must-be-at-least-32-characters-long");
    mockDb.setData();
  });

  it("未登录返回 401", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("未登录");
  });

  it("缺少套牌 ID 返回 400", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("缺少套牌 ID");
  });

  it("套牌数量超过上限返回 400", async () => {
    const res = await POST(makeRequest({ deckIds: Array.from({ length: 51 }, (_, i) => `d${i}`) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("最多 50 个");
  });

  it("越权访问返回 403", async () => {
    mockDb.setData({ decks: [], cards: [] });
    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("无权访问这些套牌");
  });

  it("缓存命中时不调用 Scryfall", async () => {
    mockDb.setData({
      decks: [{ id: "d1" }],
      cards: [
        { card_name: "Sol Ring", deck_id: "d1" },
        { card_name: "Lightning Bolt", deck_id: "d1" },
      ],
      printings: [
        { card_name: "Sol Ring", printings: [makePrinting("Sol Ring")], all_artists: ["Jung Park"] },
        { card_name: "Lightning Bolt", printings: [makePrinting("Lightning Bolt")], all_artists: ["Christopher Rush"] },
      ],
    });

    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.cacheHit).toBe(2);
    expect(json.cacheMiss).toBe(0);
    expect(json.cardCount).toBe(2);
    expect(fetchAllPrintings).not.toHaveBeenCalled();
    expect(json.cardMap).toHaveProperty("Sol Ring");
    expect(json.cardMap).toHaveProperty("Lightning Bolt");
  });

  it("缓存未命中时从 Scryfall 查询并写入缓存", async () => {
    mockDb.setData({
      decks: [{ id: "d1" }],
      cards: [{ card_name: "Sol Ring", deck_id: "d1" }],
      printings: [],
    });
    vi.mocked(fetchAllPrintings).mockResolvedValueOnce([makePrinting("Sol Ring")] as any);

    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.cacheHit).toBe(0);
    expect(json.cacheMiss).toBe(1);
    expect(fetchAllPrintings).toHaveBeenCalledWith("Sol Ring");
    expect(json.cardMap).toHaveProperty("Sol Ring");
  });

  it("合并缓存命中与未命中的结果", async () => {
    mockDb.setData({
      decks: [{ id: "d1" }],
      cards: [
        { card_name: "Sol Ring", deck_id: "d1" },
        { card_name: "Lightning Bolt", deck_id: "d1" },
      ],
      printings: [
        { card_name: "Sol Ring", printings: [makePrinting("Sol Ring")], all_artists: ["Jung Park"] },
      ],
    });
    vi.mocked(fetchAllPrintings).mockResolvedValueOnce([makePrinting("Lightning Bolt")] as any);

    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.cacheHit).toBe(1);
    expect(json.cacheMiss).toBe(1);
    expect(json.cardMap).toHaveProperty("Sol Ring");
    expect(json.cardMap).toHaveProperty("Lightning Bolt");
    expect(json.totalPrintings).toBe(2);
    expect(fetchAllPrintings).toHaveBeenCalledTimes(1);
    expect(fetchAllPrintings).toHaveBeenCalledWith("Lightning Bolt");
  });

  it("缓存 printings 非数组时视为未命中", async () => {
    mockDb.setData({
      decks: [{ id: "d1" }],
      cards: [{ card_name: "Sol Ring", deck_id: "d1" }],
      printings: [
        { card_name: "Sol Ring", printings: null, all_artists: null },
        { card_name: "Sol Ring", printings: "not-an-array", all_artists: "not-an-array" },
      ],
    });
    vi.mocked(fetchAllPrintings).mockResolvedValueOnce([makePrinting("Sol Ring")] as any);

    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.cacheHit).toBe(0);
    expect(json.cacheMiss).toBe(1);
    expect(json.cardMap).toHaveProperty("Sol Ring");
    expect(fetchAllPrintings).toHaveBeenCalledWith("Sol Ring");
  });

  it("缓存 printings 数组中存在无效项时跳过并继续服务", async () => {
    mockDb.setData({
      decks: [{ id: "d1" }],
      cards: [
        { card_name: "Sol Ring", deck_id: "d1" },
        { card_name: "Mana Crypt", deck_id: "d1" },
      ],
      printings: [
        {
          card_name: "Sol Ring",
          printings: [
            makePrinting("Sol Ring"),
            null,
            { artist: null, set: "CMM", set_name: "CMM", collector_number: "345", image_url: null, released_at: "2024-01-01" },
            { artist: "Jung Park", set: null, set_name: "CMM", collector_number: "345", image_url: null, released_at: "2024-01-01" },
          ],
          all_artists: ["Jung Park"],
        },
        { card_name: "Mana Crypt", printings: [makePrinting("Mana Crypt")], all_artists: ["Mark Tedin"] },
      ],
    });

    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.cacheHit).toBe(2);
    expect(json.cacheMiss).toBe(0);
    expect(json.cardMap["Sol Ring"].printings.length).toBe(1);
    expect(json.cardMap["Mana Crypt"].printings.length).toBe(1);
  });

  it("Scryfall 返回的 printings 含无效项时过滤后写入缓存", async () => {
    mockDb.setData({
      decks: [{ id: "d1" }],
      cards: [{ card_name: "Sol Ring", deck_id: "d1" }],
      printings: [],
    });
    vi.mocked(fetchAllPrintings).mockResolvedValueOnce([
      makePrinting("Sol Ring"),
      null,
      { artist: "Jung Park", set: "CMM", set_name: "CMM", collector_number: "345" } as any,
    ] as any);

    const res = await POST(makeRequest({ deckIds: ["d1"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.cardMap["Sol Ring"].printings.length).toBe(1);
  });
});
