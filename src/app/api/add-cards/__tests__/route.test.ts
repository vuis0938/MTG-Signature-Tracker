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

vi.mock("@/lib/scryfall-client", () => {
  class MockRateLimiter {
    acquire() {
      return Promise.resolve();
    }
  }
  return {
    batchSearch: vi.fn(),
    extractArtists: vi.fn(() => ["Artist"]),
    extractImageUrl: vi.fn(() => "http://example.com/card.png"),
    RateLimiter: MockRateLimiter,
  };
});

vi.mock("@/lib/moxfield-parser", () => ({
  parseMoxfieldFormat: vi.fn(() => []),
}));

vi.mock("@/lib/cache-printings", () => ({
  warmCardPrintingsCache: vi.fn(() => Promise.resolve({ cached: 1, failed: 0, total: 1 })),
}));

vi.mock("@/lib/touch-deck", () => ({
  touchDeck: vi.fn(() => Promise.resolve()),
}));

import { POST } from "../route";
import { supabase as rawSupabase } from "@/lib/supabase";
import { getUserFromRequest } from "@/lib/auth";
import { parseMoxfieldFormat } from "@/lib/moxfield-parser";
import { batchSearch } from "@/lib/scryfall-client";
import { warmCardPrintingsCache } from "@/lib/cache-printings";
import { touchDeck } from "@/lib/touch-deck";

const supabase = rawSupabase as any;

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

function makeCard(id: string, name: string) {
  return {
    id,
    name,
    set_name: "Set",
    set: "SET",
    collector_number: "1",
    artist: "Artist",
    image_uris: {
      normal: "http://example.com/card.png",
      small: "http://example.com/card-small.png",
      png: "http://example.com/card.png",
    },
  };
}

describe("/api/add-cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserFromRequest).mockResolvedValue("alice");
    vi.mocked(parseMoxfieldFormat).mockReturnValue([]);
    vi.mocked(batchSearch).mockResolvedValue([]);
  });

  it("未登录返回 401", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ deckId: "d1", text: "1 Sol Ring" }));
    expect(res.status).toBe(401);
  });

  it("缺少 deckId 返回 400", async () => {
    const res = await POST(makeRequest({ text: "1 Sol Ring" }));
    expect(res.status).toBe(400);
  });

  it("缺少文本返回 400", async () => {
    const res = await POST(makeRequest({ deckId: "d1" }));
    expect(res.status).toBe(400);
  });

  it("文本过长返回 400", async () => {
    const res = await POST(makeRequest({ deckId: "d1", text: "a".repeat(50001) }));
    expect(res.status).toBe(400);
  });

  it("套牌不归属当前用户返回 404", async () => {
    setupFromSequence(supabase.from, [
      { data: null, error: { code: "PGRST116" } },
    ]);
    const res = await POST(makeRequest({ deckId: "d1", text: "1 Sol Ring" }));
    expect(res.status).toBe(404);
  });

  it("解析结果为空返回 400", async () => {
    setupFromSequence(supabase.from, [{ data: { id: "d1" }, error: null }]);
    vi.mocked(parseMoxfieldFormat).mockReturnValueOnce([]);
    const res = await POST(makeRequest({ deckId: "d1", text: "not a deck" }));
    expect(res.status).toBe(400);
  });

  it("成功追加卡牌", async () => {
    const rows = [
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
      { count: "2", name: "Lightning Bolt", setCode: "MM2", collectorNumber: "1" },
    ];
    vi.mocked(parseMoxfieldFormat).mockReturnValueOnce(rows);
    vi.mocked(batchSearch).mockResolvedValueOnce([
      makeCard("s1", "Sol Ring"),
      makeCard("l1", "Lightning Bolt"),
    ]);
    setupFromSequence(supabase.from, [
      { data: { id: "d1" }, error: null },
      { error: null },
    ]);

    const res = await POST(makeRequest({ deckId: "d1", text: "1 Sol Ring (CMM) 345\n2 Lightning Bolt (MM2) 1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.total).toBe(3);
    expect(json.successCount).toBe(3);
    expect(json.failCount).toBe(0);
    expect(vi.mocked(touchDeck)).toHaveBeenCalledWith("d1");
    expect(vi.mocked(warmCardPrintingsCache)).toHaveBeenCalledWith(["Sol Ring", "Lightning Bolt"]);
  });

  it("Scryfall 部分未找到时返回失败详情", async () => {
    const rows = [
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
      { count: "1", name: "Unknown Card" },
    ];
    vi.mocked(parseMoxfieldFormat).mockReturnValueOnce(rows);
    vi.mocked(batchSearch).mockResolvedValueOnce([makeCard("s1", "Sol Ring"), null]);
    setupFromSequence(supabase.from, [
      { data: { id: "d1" }, error: null },
      { error: null },
    ]);

    const res = await POST(makeRequest({ deckId: "d1", text: "..." }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.successCount).toBe(1);
    expect(json.failCount).toBe(1);
    expect(json.failedCards).toHaveLength(1);
    expect(json.failedCards[0].name).toBe("Unknown Card");
  });

  it("批量插入失败时降级为逐条插入", async () => {
    const rows = [
      { count: "1", name: "Sol Ring", setCode: "CMM", collectorNumber: "345" },
      { count: "1", name: "Lightning Bolt", setCode: "MM2", collectorNumber: "1" },
    ];
    vi.mocked(parseMoxfieldFormat).mockReturnValueOnce(rows);
    vi.mocked(batchSearch).mockResolvedValueOnce([
      makeCard("s1", "Sol Ring"),
      makeCard("l1", "Lightning Bolt"),
    ]);
    setupFromSequence(supabase.from, [
      { data: { id: "d1" }, error: null },
      { error: { message: "batch insert failed" } },
      { error: null },
      { error: null },
    ]);

    const res = await POST(makeRequest({ deckId: "d1", text: "..." }));
    expect(res.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("cards");
    const insertCalls = supabase.from.mock.results
      .map((r: any) => r.value)
      .filter((chain: any) => typeof chain?.insert === "function");
    expect(insertCalls.length).toBeGreaterThanOrEqual(3);
  });
});
