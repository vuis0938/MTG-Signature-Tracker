// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Printing } from "@/types";

vi.mock("@/lib/supabase", () => {
  const getSupabase = vi.fn();
  const supabase = new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      const client = getSupabase();
      return Reflect.get(client as object, prop);
    },
  });
  return { getSupabase, supabase };
});

vi.mock("@/lib/scryfall-client", () => ({
  fetchAllPrintings: vi.fn(),
  delay: vi.fn(() => Promise.resolve()),
}));

interface PrintingsClientConfig {
  existing?: string[];
  batchInsertResult?: { error: { message: string } | null };
  fallbackInsertResults?: { error: { message: string } | null }[];
}

function createPrintingsClient(config: PrintingsClientConfig) {
  let fallbackIndex = 0;

  function selectChain() {
    const chain: Record<string, unknown> = {};
    const handler = () => chain;
    chain.select = handler;
    chain.in = handler;
    chain.then = (cb: (result: unknown) => unknown) =>
      Promise.resolve(
        cb({
          data: (config.existing || []).map((card_name) => ({ card_name })),
          error: null,
        })
      );
    return chain;
  }

  function insertChain() {
    const chain: Record<string, unknown> = {};
    const handler = () => chain;
    chain.insert = handler;
    chain.then = (cb: (result: unknown) => unknown) => {
      if (
        config.fallbackInsertResults &&
        fallbackIndex < config.fallbackInsertResults.length
      ) {
        const result = config.fallbackInsertResults[fallbackIndex++];
        return Promise.resolve(cb(result));
      }
      return Promise.resolve(cb(config.batchInsertResult || { error: null }));
    };
    return chain;
  }

  return {
    from: vi.fn((table: string) => {
      if (table !== "card_printings") return {};
      return {
        select: () => selectChain(),
        insert: () => insertChain(),
      };
    }),
  };
}

function makePrinting(artist: string): Printing {
  return {
    artist,
    set: "SET",
    set_name: "Set",
    collector_number: "1",
    image_url: "http://example.com/card.png",
    released_at: "2024-01-01",
  };
}

async function loadCacheModule() {
  return import("@/lib/cache-printings");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("warmCardPrintingsCache", () => {
  it("全部已缓存时直接返回命中，不调用 Scryfall", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchAllPrintings } = await import("@/lib/scryfall-client");

    vi.mocked(getSupabase).mockReturnValue(
      createPrintingsClient({ existing: ["Lightning Bolt", "Counterspell"] }) as unknown as ReturnType<typeof getSupabase>
    );

    const { warmCardPrintingsCache } = await loadCacheModule();
    const result = await warmCardPrintingsCache(["Lightning Bolt", "Counterspell"]);

    expect(result).toEqual({ cached: 2, failed: 0, total: 2 });
    expect(fetchAllPrintings).not.toHaveBeenCalled();
  });

  it("批量命中与未命中混合时只请求未缓存卡牌", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchAllPrintings } = await import("@/lib/scryfall-client");

    vi.mocked(fetchAllPrintings).mockResolvedValue([makePrinting("Artist A")]);

    vi.mocked(getSupabase).mockReturnValue(
      createPrintingsClient({ existing: ["Lightning Bolt"] }) as unknown as ReturnType<typeof getSupabase>
    );

    const { warmCardPrintingsCache } = await loadCacheModule();
    const result = await warmCardPrintingsCache(["Lightning Bolt", "Counterspell"]);

    expect(result).toEqual({ cached: 2, failed: 0, total: 2 });
    expect(fetchAllPrintings).toHaveBeenCalledTimes(1);
    expect(fetchAllPrintings).toHaveBeenCalledWith("Counterspell");
  });

  it("输入去重后统计 total", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchAllPrintings } = await import("@/lib/scryfall-client");

    vi.mocked(fetchAllPrintings).mockResolvedValue([makePrinting("Artist A")]);

    vi.mocked(getSupabase).mockReturnValue(
      createPrintingsClient({ existing: [] }) as unknown as ReturnType<typeof getSupabase>
    );

    const { warmCardPrintingsCache } = await loadCacheModule();
    const result = await warmCardPrintingsCache(["Counterspell", "Counterspell"]);

    expect(result.total).toBe(1);
    expect(fetchAllPrintings).toHaveBeenCalledTimes(1);
  });

  it("并发控制：10 张未缓存卡牌分 2 批处理并触发一次延迟", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchAllPrintings, delay } = await import("@/lib/scryfall-client");

    vi.mocked(fetchAllPrintings).mockResolvedValue([makePrinting("Artist A")]);

    const client = createPrintingsClient({ existing: [] });
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    const names = Array.from({ length: 10 }, (_, i) => `Card-${i}`);
    const { warmCardPrintingsCache } = await loadCacheModule();
    const result = await warmCardPrintingsCache(names);

    expect(result.total).toBe(10);
    expect(result.cached).toBe(10);
    expect(fetchAllPrintings).toHaveBeenCalledTimes(10);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(150);
  });

  it("Scryfall 返回空数组时计入 failed", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchAllPrintings } = await import("@/lib/scryfall-client");

    vi.mocked(fetchAllPrintings).mockImplementation(async (name: string) =>
      name.startsWith("fail") ? [] : [makePrinting("Artist A")]
    );

    vi.mocked(getSupabase).mockReturnValue(
      createPrintingsClient({ existing: [] }) as unknown as ReturnType<typeof getSupabase>
    );

    const { warmCardPrintingsCache } = await loadCacheModule();
    const result = await warmCardPrintingsCache(["fail-one", "fail-two", "ok-card"]);

    expect(result).toEqual({ cached: 1, failed: 2, total: 3 });
  });

  it("批量插入失败时降级逐条插入", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchAllPrintings } = await import("@/lib/scryfall-client");

    vi.mocked(fetchAllPrintings).mockResolvedValue([makePrinting("Artist A")]);

    const client = createPrintingsClient({
      existing: [],
      batchInsertResult: { error: { message: "batch insert failed" } },
      fallbackInsertResults: [{ error: null }],
    });
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    const { warmCardPrintingsCache } = await loadCacheModule();
    const result = await warmCardPrintingsCache(["Sol Ring"]);

    expect(result).toEqual({ cached: 1, failed: 0, total: 1 });
    expect(client.from).toHaveBeenCalledWith("card_printings");
  });

  it("降级逐条插入也失败时计入 failed", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchAllPrintings } = await import("@/lib/scryfall-client");

    vi.mocked(fetchAllPrintings).mockResolvedValue([makePrinting("Artist A")]);

    vi.mocked(getSupabase).mockReturnValue(
      createPrintingsClient({
        existing: [],
        batchInsertResult: { error: { message: "batch insert failed" } },
        fallbackInsertResults: [{ error: { message: "row insert failed" } }],
      }) as unknown as ReturnType<typeof getSupabase>
    );

    const { warmCardPrintingsCache } = await loadCacheModule();
    const result = await warmCardPrintingsCache(["Bad Card"]);

    expect(result).toEqual({ cached: 0, failed: 1, total: 1 });
  });
});
