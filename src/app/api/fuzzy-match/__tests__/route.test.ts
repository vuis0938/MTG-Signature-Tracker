import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ═════════════════════════════════════════════════════════════
// fuzzy-match 反向查询路由测试
//
// 覆盖三条关键路径：
// 1. 缺少画家名单 → 400
// 2. 缓存命中 → 直接用 artist_cards 反转成 cardMap，不调 Scryfall
// 3. 缓存未命中 → 调 fetchArtistCards 拉取并返回
// ═════════════════════════════════════════════════════════════

// 用 vi.hoisted 让 mock 工厂与测试体共享可变状态
const h = vi.hoisted(() => ({
  fetchArtistCards: vi.fn(),
  cachedRows: [] as unknown[],
  deckCards: [] as unknown[],
}));

vi.mock("@/lib/scryfall-client", () => ({
  fetchArtistCards: h.fetchArtistCards,
  // 路由用 `new RateLimiter(10)` 构造，箭头函数不能当构造函数，用普通 function
  RateLimiter: function () {
    return { acquire: async () => {}, pause() {} };
  },
}));

vi.mock("@/lib/artist-aliases", () => ({
  loadArtistAliases: vi.fn(async () => new Map()),
  resolveAliases: vi.fn((artists: string[]) => artists),
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(() => "test-user"),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true })),
  getClientIP: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "decks") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [{ id: "deck-1" }], error: null })),
            })),
          })),
        };
      }
      if (table === "artist_cards") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({ data: h.cachedRows, error: null })),
          })),
          upsert: vi.fn(() => ({
            then: vi.fn(async (cb: (r: { error: null }) => void) => cb({ error: null })),
          })),
        };
      }
      if (table === "cards") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({ data: h.deckCards, error: null })),
          })),
        };
      }
      return { select: vi.fn(), upsert: vi.fn() };
    }),
  },
}));

import { POST } from "../route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/fuzzy-match", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  h.fetchArtistCards.mockReset();
  h.cachedRows = [];
  h.deckCards = [];
});

describe("fuzzy-match 反向查询路由", () => {
  it("缺少画家名单返回 400", async () => {
    const res = await POST(makeRequest({ deckIds: ["deck-1"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("缺少画家名单");
  });

  it("缓存命中：反转成 cardMap 并过滤套牌外卡，不调 Scryfall", async () => {
    h.deckCards = [{ card_name: "Forest" }];
    h.cachedRows = [
      {
        artist_name: "John Avon",
        cards: [
          {
            name: "Forest",
            set: "LEA",
            set_name: "Limited Edition Alpha",
            collector_number: "300",
            image_url: "https://a.jpg",
            released_at: "1993-08-05",
          },
          {
            // 套牌里没有这张卡，应被过滤掉
            name: "Lightning Bolt",
            set: "LEA",
            set_name: "Limited Edition Alpha",
            collector_number: "156",
            image_url: "https://b.jpg",
            released_at: "1993-08-05",
          },
        ],
      },
    ];

    const res = await POST(makeRequest({ deckIds: ["deck-1"], artists: ["John Avon"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.cardMap.Forest.allArtists).toEqual(["John Avon"]);
    expect(body.cardMap.Forest.printings[0]).toMatchObject({
      artist: "John Avon",
      set: "LEA",
      collector_number: "300",
    });
    // 套牌外的卡被过滤掉
    expect(body.cardMap["Lightning Bolt"]).toBeUndefined();
    // 缓存命中，不应触发 Scryfall 请求
    expect(h.fetchArtistCards).not.toHaveBeenCalled();
  });

  it("缓存未命中：调 fetchArtistCards 拉取并返回", async () => {
    h.cachedRows = [];
    h.deckCards = [{ card_name: "Island" }];
    h.fetchArtistCards.mockResolvedValue({
      cards: [
        {
          name: "Island",
          set: "LEB",
          set_name: "Limited Edition Beta",
          collector_number: "287",
          image_url: null,
          released_at: "1993-10-04",
        },
      ],
      complete: true,
    });

    const res = await POST(makeRequest({ deckIds: ["deck-1"], artists: ["Kev Walker"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cardMap.Island.allArtists).toEqual(["Kev Walker"]);
    expect(body.cardMap.Island.printings[0]).toMatchObject({ artist: "Kev Walker", set: "LEB" });
    expect(h.fetchArtistCards).toHaveBeenCalledTimes(1);
    expect(h.fetchArtistCards).toHaveBeenCalledWith("Kev Walker", expect.anything());
  });
});
