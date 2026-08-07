// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockDb = vi.hoisted(() => {
  let dbCards: { cards: any[] } | null = null;
  return {
    setCards: (cards: { cards: any[] } | null) => { dbCards = cards; },
    getCards: () => dbCards,
  };
});

vi.mock("@/lib/supabase", () => {
  const mockClient: any = {
    from: vi.fn(() => mockClient),
    select: vi.fn(() => mockClient),
    insert: vi.fn(() => mockClient),
    update: vi.fn(() => mockClient),
    eq: vi.fn(() => mockClient),
    in: vi.fn(() => mockClient),
    limit: vi.fn(() => mockClient),
    single: vi.fn(() => Promise.resolve({ data: mockDb.getCards(), error: { code: "PGRST116" } })),
    upsert: vi.fn(() => Promise.resolve({ error: null })),
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

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(() => Promise.resolve("alice")),
}));

vi.mock("@/lib/scryfall-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scryfall-client")>("@/lib/scryfall-client");
  return {
    ...actual,
    delay: vi.fn(() => Promise.resolve()),
  };
});

import { getUserFromRequest } from "@/lib/auth";

function makeRequest(artist: string): NextRequest {
  return {
    url: `http://localhost/api/artist-cards?artist=${encodeURIComponent(artist)}`,
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

function makeScryfallCard(name: string): Record<string, unknown> {
  return {
    name,
    set: "TST",
    set_name: "Test Set",
    collector_number: "1",
    image_uris: { normal: "https://example.com/card.jpg" },
    released_at: "2024-01-01",
  };
}

function mockFetch(response: { status: number; body: any }) {
  return vi.fn(() => Promise.resolve(
    new Response(JSON.stringify(response.body), { status: response.status })
  ));
}

describe("/api/artist-cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOKEN_SECRET", "test-secret-must-be-at-least-32-characters-long");
    mockDb.setCards(null);
    global.fetch = mockFetch({ status: 200, body: { data: [makeScryfallCard("Test Card")], has_more: false } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("未登录返回 401", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const { GET } = await import("../route");
    const res = await GET(makeRequest("John Avon"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("未登录");
  });

  it("内存缓存命中时直接返回", async () => {
    const { GET } = await import("../route");
    const res1 = await GET(makeRequest("John Avon"));
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.cached).toBe(false);
    expect(json1.count).toBe(1);

    const res2 = await GET(makeRequest("John Avon"));
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.cached).toBe(true);
    expect(json2.count).toBe(1);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("DB 缓存命中时不请求 Scryfall", async () => {
    const dbCards = {
      cards: [{
        name: "DB Card",
        set: "DBS",
        set_name: "DB Set",
        collector_number: "99",
        image_url: "https://example.com/db.jpg",
        released_at: "2023-01-01",
      }],
    };
    mockDb.setCards(dbCards);

    const { GET } = await import("../route");
    const res = await GET(makeRequest("John Avon"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(true);
    expect(json.count).toBe(1);
    expect(json.cards[0].name).toBe("DB Card");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Scryfall 空结果也写入内存缓存", async () => {
    global.fetch = mockFetch({ status: 404, body: {} });

    const { GET } = await import("../route");
    const res1 = await GET(makeRequest("Unknown Artist"));
    expect(res1.status).toBe(404);
    const json1 = await res1.json();
    expect(json1.error).toContain("未找到画家");

    const res2 = await GET(makeRequest("Unknown Artist"));
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.cached).toBe(true);
    expect(json2.count).toBe(0);
    expect(json2.cards).toEqual([]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("内存缓存超过 200 条时淘汰最旧条目", async () => {
    const { GET } = await import("../route");
    const artistNames = Array.from({ length: 201 }, (_, i) => `Artist ${i}`);

    for (const name of artistNames) {
      await GET(makeRequest(name));
    }

    // Artist 0 should have been evicted; requesting it again triggers a new Scryfall call
    await GET(makeRequest(artistNames[0]));

    expect(global.fetch).toHaveBeenCalledTimes(202);
  });
});
