import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ═════════════════════════════════════════════════════════════
// refresh-card-cache cron 路由测试
//
// 覆盖：
// 1. 无/错 CRON_SECRET → 401
// 2. 空增量 → 成功并推进 since
// 3. 增量命中缓存 → 刷新卡片（warm）+ 画家（fetchArtistCards+upsert）
// 4. 增量查询失败 → 500 + 写审计日志 + 不推进 since
// ═════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  metaSince: null as string | null,
  metaUpserted: false,
  affectedCards: [] as string[],
  affectedArtists: [] as string[],
  artistUpserts: [] as string[],
  warmResult: { cached: 0, failed: 0, total: 0 },
  warmCalledWith: [] as string[][],
  artistCardsResult: { cards: [] as unknown[], complete: true },
  deltaCards: [] as unknown[],
  deltaHttpError: null as number | null,
  logFail: null as string | null,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: (table: string) => {
      if (table === "scryfall_meta") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: h.metaSince ? { value: { since: h.metaSince } } : null,
              }),
            }),
          }),
          upsert: async () => {
            h.metaUpserted = true;
            return { error: null };
          },
        };
      }
      if (table === "card_printings") {
        return {
          select: () => ({
            in: async () => ({
              data: h.affectedCards.map((n) => ({ card_name: n })),
            }),
          }),
        };
      }
      if (table === "artist_cards") {
        return {
          select: () => ({
            in: async () => ({
              data: h.affectedArtists.map((a) => ({ artist_name: a })),
            }),
          }),
          upsert: async (row: { artist_name: string }) => {
            h.artistUpserts.push(row.artist_name);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  })),
}));

vi.mock("@/lib/admin", () => ({
  logAdminAction: vi.fn(async (_user: string, action: string) => {
    h.logFail = action;
  }),
}));

vi.mock("@/lib/cache-printings", () => ({
  warmCardPrintingsCache: vi.fn(async (names: string[]) => {
    h.warmCalledWith.push(names);
    return h.warmResult;
  }),
}));

vi.mock("@/lib/scryfall-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall-client")>();
  return {
    ...actual,
    fetchArtistCards: vi.fn(async () => h.artistCardsResult),
  };
});

vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    if (h.deltaHttpError) {
      return { ok: false, status: h.deltaHttpError, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => ({ data: h.deltaCards, has_more: false }),
    };
  })
);

import { GET } from "../route";

function makeRequest(secret = "test-secret"): NextRequest {
  return new NextRequest("http://localhost/api/cron/refresh-card-cache", {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  h.metaSince = null;
  h.metaUpserted = false;
  h.affectedCards = [];
  h.affectedArtists = [];
  h.artistUpserts = [];
  h.warmResult = { cached: 0, failed: 0, total: 0 };
  h.warmCalledWith = [];
  h.artistCardsResult = { cards: [], complete: true };
  h.deltaCards = [];
  h.deltaHttpError = null;
  h.logFail = null;
  process.env.CRON_SECRET = "test-secret";
});

describe("refresh-card-cache cron", () => {
  it("无/错密钥：401", async () => {
    const res = await GET(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("空增量：成功并推进 since", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(h.metaUpserted).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.newCards).toBe(0);
    expect(body.refreshedCards).toBe(0);
    expect(body.refreshedArtists).toBe(0);
  });

  it("增量命中缓存：刷新卡片和画家", async () => {
    h.deltaCards = [{ name: "Lightning Bolt", artist: "John Avon" }];
    h.affectedCards = ["Lightning Bolt"];
    h.affectedArtists = ["John Avon"];
    h.warmResult = { cached: 1, failed: 0, total: 1 };
    h.artistCardsResult = { cards: [{ name: "Lightning Bolt" }], complete: true };

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newCards).toBe(1);
    expect(body.refreshedCards).toBe(1);
    expect(body.refreshedArtists).toBe(1);
    expect(h.warmCalledWith).toEqual([["Lightning Bolt"]]);
    expect(h.artistUpserts).toEqual(["John Avon"]);
  });

  it("增量查询失败：500 且写审计日志、不推进 since", async () => {
    h.deltaHttpError = 500;

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    expect(h.logFail).toBe("cron_refresh_fail");
    expect(h.metaUpserted).toBe(false);
  });
});
