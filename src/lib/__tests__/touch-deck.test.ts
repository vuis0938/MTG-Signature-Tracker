// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase", () => {
  const getSupabase = vi.fn();
  return { getSupabase };
});

function createDeckClient(finalResult: { error: { message: string } | null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler = vi.fn(() => chain);
  chain.from = handler;
  chain.update = handler;
  chain.eq = handler;
  chain.in = handler;
  chain.then = vi.fn((cb: (result: unknown) => unknown) =>
    Promise.resolve(cb(finalResult))
  );
  return chain;
}

async function loadTouchModule() {
  return import("@/lib/touch-deck");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("touchDeck", () => {
  it("更新单套牌的 updated_at", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const client = createDeckClient({ error: null });
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    const { touchDeck } = await loadTouchModule();
    await touchDeck("deck-1");

    expect(client.from).toHaveBeenCalledWith("decks");
    expect(client.update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
    expect(client.eq).toHaveBeenCalledWith("id", "deck-1");
  });

  it("更新失败时不抛出，仅记录错误", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createDeckClient({ error: { message: "db error" } });
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    const { touchDeck } = await loadTouchModule();
    await expect(touchDeck("deck-1")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("touchDecks", () => {
  it("批量更新多套牌并去重", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const client = createDeckClient({ error: null });
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    const { touchDecks } = await loadTouchModule();
    await touchDecks(["deck-1", "deck-2", "deck-1"]);

    expect(client.from).toHaveBeenCalledWith("decks");
    expect(client.update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
    expect(client.in).toHaveBeenCalledWith("id", ["deck-1", "deck-2"]);
  });

  it("空数组时不发起数据库请求", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn(),
    } as unknown as ReturnType<typeof getSupabase>);

    const { touchDecks } = await loadTouchModule();
    await touchDecks([]);

    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("批量更新失败时不抛出", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createDeckClient({ error: { message: "db error" } });
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    const { touchDecks } = await loadTouchModule();
    await expect(touchDecks(["deck-1", "deck-2"])).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
