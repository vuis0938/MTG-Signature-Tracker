// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(),
}));

/** 构造一个极简的链式 Supabase mock：所有方法都返回自身，直到某个终点返回 Promise */
function createChainMock(finalResult: unknown): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const handler = () => chain;
  chain.select = handler;
  chain.eq = handler;
  chain.order = handler;
  chain.in = handler;
  chain.from = handler;
  chain.then = (cb: (result: unknown) => unknown) => Promise.resolve(cb(finalResult));
  return chain;
}

async function loadDataModule() {
  return import("@/lib/data");
}

describe("getDecksWithStats", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("心动卡牌(status=3)同时计入待签与心动统计", async () => {
    const { getSupabase } = await import("@/lib/supabase");

    const decksResult = {
      data: [
        { id: "deck-1", name: "Test Deck", source: "plain", created_at: "2024-01-01T00:00:00Z" },
      ],
      error: null,
    };

    const cardsResult = {
      data: [
        { deck_id: "deck-1", status: 0 },
        { deck_id: "deck-1", status: 1 },
        { deck_id: "deck-1", status: 2 },
        { deck_id: "deck-1", status: 3 },
      ],
      error: null,
    };

    let fromCallCount = 0;
    const mockClient = createChainMock(decksResult) as {
      from: ReturnType<typeof vi.fn>;
      [key: string]: unknown;
    };

    mockClient.from = vi.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return mockClient;
      }
      // 第二次 from 返回卡牌查询链
      return {
        ...createChainMock(cardsResult),
        select: () => createChainMock(cardsResult),
      };
    });

    vi.mocked(getSupabase).mockReturnValue(mockClient as unknown as ReturnType<typeof getSupabase>);

    const { getDecksWithStats } = await loadDataModule();
    const { stats } = await getDecksWithStats("user-1");

    expect(stats["deck-1"]).toEqual({
      total: 4,
      unsigned: 2, // status 0 + status 3
      pending: 1,  // status 1
      heart: 1,    // status 3
    });
  });
});

describe("getDecksWithCards", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("心动卡牌(status=3)同时计入待签与心动统计", async () => {
    const { getSupabase } = await import("@/lib/supabase");

    const decksResult = {
      data: [
        { id: "deck-1", name: "Test Deck", source: "plain", created_at: "2024-01-01T00:00:00Z" },
      ],
      error: null,
    };

    const cardsResult = {
      data: [
        { id: "c1", deck_id: "deck-1", card_name: "Card 1", set_code: "set", collector_number: "1", artist_names: ["Artist"], image_url: "", status: 3, is_signed: false, event_name: null, event_date: null },
        { id: "c2", deck_id: "deck-1", card_name: "Card 2", set_code: "set", collector_number: "2", artist_names: ["Artist"], image_url: "", status: 0, is_signed: false, event_name: null, event_date: null },
      ],
      error: null,
    };

    let fromCallCount = 0;
    const mockClient = createChainMock(decksResult) as {
      from: ReturnType<typeof vi.fn>;
      [key: string]: unknown;
    };

    mockClient.from = vi.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return mockClient;
      }
      return {
        ...createChainMock(cardsResult),
        select: () => ({
          ...createChainMock(cardsResult),
          in: () => ({
            ...createChainMock(cardsResult),
            order: () => Promise.resolve(cardsResult),
          }),
        }),
      };
    });

    vi.mocked(getSupabase).mockReturnValue(mockClient as unknown as ReturnType<typeof getSupabase>);

    const { getDecksWithCards } = await loadDataModule();
    const { stats, cardsByDeck } = await getDecksWithCards("user-1");

    expect(stats["deck-1"]).toEqual({
      total: 2,
      unsigned: 2,
      pending: 0,
      heart: 1,
    });
    expect(cardsByDeck["deck-1"]).toHaveLength(2);
  });
});
