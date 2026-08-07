// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockWarm = vi.hoisted(() => vi.fn(() => Promise.resolve({ cached: 0, failed: 0, total: 0 })));
const mockTouch = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@/lib/supabase", () => {
  const mockClient: any = {
    from: vi.fn(() => mockClient),
    select: vi.fn(() => mockClient),
    insert: vi.fn(() => mockClient),
    update: vi.fn(() => mockClient),
    eq: vi.fn(() => mockClient),
    in: vi.fn(() => mockClient),
    limit: vi.fn(() => mockClient),
    single: vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } })),
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

vi.mock("@/lib/cache-printings", () => ({
  warmCardPrintingsCache: mockWarm,
}));

vi.mock("@/lib/touch-deck", () => ({
  touchDeck: mockTouch,
}));

vi.mock("@/lib/scryfall-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scryfall-client")>("@/lib/scryfall-client");
  return {
    ...actual,
    batchSearch: vi.fn(),
    RateLimiter: vi.fn(function () {
      return {
        acquire: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
      };
    }),
  };
});

import { POST } from "../route";
import { getUserFromRequest } from "@/lib/auth";
import { supabase as rawSupabase } from "@/lib/supabase";
import { batchSearch } from "@/lib/scryfall-client";
import type { ScryfallCard } from "@/lib/scryfall-client";

const supabase = rawSupabase as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: "scry-1",
    name: "Sol Ring",
    set_name: "Commander Masters",
    set: "CMM",
    collector_number: "345",
    artist: "Jung Park",
    image_uris: {
      normal: "https://example.com/sol-ring.jpg",
      small: "https://example.com/sol-ring-small.jpg",
      png: "https://example.com/sol-ring.png",
    },
    ...overrides,
  };
}

describe("/api/import-deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOKEN_SECRET", "test-secret-must-be-at-least-32-characters-long");

    vi.mocked(supabase.from).mockReturnValue(supabase as any);
    vi.mocked(supabase.select).mockReturnValue(supabase as any);
    vi.mocked(supabase.insert).mockReturnValue(supabase as any);
    vi.mocked(supabase.update).mockReturnValue(supabase as any);
    vi.mocked(supabase.eq).mockReturnValue(supabase as any);
    vi.mocked(supabase.in).mockReturnValue(supabase as any);
    vi.mocked(supabase.limit).mockReturnValue(supabase as any);
    vi.mocked(supabase.single).mockResolvedValue({ data: null, error: { code: "PGRST116" } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未登录返回 401", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ name: "Deck", text: "1 Sol Ring" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("未登录");
  });

  it("缺少套牌名称返回 400", async () => {
    const res = await POST(makeRequest({ name: "", text: "1 Sol Ring" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("请输入套牌名称");
  });

  it("缺少套牌内容返回 400", async () => {
    const res = await POST(makeRequest({ name: "Deck", text: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("请粘贴套牌列表内容");
  });

  it("套牌内容过长返回 400", async () => {
    const res = await POST(makeRequest({ name: "Deck", text: "x".repeat(50001) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("过长");
  });

  it("未识别到卡牌返回 400", async () => {
    const res = await POST(makeRequest({ name: "Deck", text: "just some random text" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("未识别到卡牌");
  });

  it("Scryfall 批量查询成功并写入数据库", async () => {
    vi.mocked(supabase.single).mockResolvedValueOnce({ data: { id: "deck-1" }, error: null });
    vi.mocked(batchSearch).mockResolvedValueOnce([makeCard({ id: "scry-1", name: "Sol Ring" })]);

    const res = await POST(makeRequest({ name: "My Deck", text: "1 Sol Ring" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.deckId).toBe("deck-1");
    expect(json.total).toBe(1);
    expect(json.successCount).toBe(1);
    expect(json.failCount).toBe(0);

    const insertCalls = vi.mocked(supabase.insert).mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    const cardsInsert = insertCalls[1][0] as any[];
    expect(cardsInsert).toHaveLength(1);
    expect(cardsInsert[0]).toMatchObject({
      deck_id: "deck-1",
      scryfall_id: "scry-1",
      card_name: "Sol Ring",
      set_code: "CMM",
      collector_number: "345",
      artist_names: ["Jung Park"],
      image_url: "https://example.com/sol-ring.jpg",
    });

    expect(mockTouch).toHaveBeenCalledWith("deck-1");
    expect(mockWarm).toHaveBeenCalledWith(["Sol Ring"]);
  });

  it("Scryfall 部分失败时返回失败卡牌", async () => {
    vi.mocked(supabase.single).mockResolvedValueOnce({ data: { id: "deck-2" }, error: null });
    vi.mocked(batchSearch).mockResolvedValueOnce([
      makeCard({ id: "scry-1", name: "Sol Ring" }),
      null,
    ]);

    const res = await POST(makeRequest({ name: "Partial", text: "1 Sol Ring\n1 Unknown Card" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.total).toBe(2);
    expect(json.successCount).toBe(1);
    expect(json.failCount).toBe(1);
    expect(json.failedCards).toEqual([{ name: "Unknown Card" }]);

    const insertCalls = vi.mocked(supabase.insert).mock.calls;
    const cardsInsert = insertCalls[1][0] as any[];
    expect(cardsInsert).toHaveLength(1);
    expect(cardsInsert[0].card_name).toBe("Sol Ring");
  });

  it("超过软超时时间时标记为 timedOut", async () => {
    vi.mocked(supabase.single).mockResolvedValueOnce({ data: { id: "deck-3" }, error: null });
    vi.mocked(batchSearch).mockResolvedValueOnce([makeCard({ id: "scry-1", name: "Sol Ring" })]);

    const nowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(180_001);

    const res = await POST(makeRequest({ name: "Timeout", text: "1 Sol Ring" }));
    nowSpy.mockRestore();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.timedOut).toBe(true);
    expect(json.timedOutCards).toEqual([{ name: "Sol Ring" }]);
    expect(json.successCount).toBe(0);
    expect(json.failCount).toBe(1);
  });
});
