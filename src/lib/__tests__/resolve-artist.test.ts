import { describe, it, expect, vi, beforeEach } from "vitest";

// ═════════════════════════════════════════════════════════════
// resolveArtistName 测试
//
// 覆盖：
// 1. 本地名单精确命中（大小写变体）→ 返回标准名，不打 Scryfall
// 2. 本地名单模糊命中（编辑距离 ≤1）→ 返回标准名，不打 Scryfall
// 3. 本地名单未命中 → 回退 Scryfall 精确查一次兜底
// 4. 精确查命中 + 大小写变体 → 提取 Scryfall 标准名
// 5. 本地未命中 + Scryfall 也查不到 → null
// ═════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  fetchArtistCards: vi.fn(),
  loadAllArtists: vi.fn(),
}));

vi.mock("@/lib/scryfall-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall-client")>();
  return {
    ...actual,
    fetchArtistCards: h.fetchArtistCards,
  };
});

vi.mock("@/lib/artists-catalog", () => ({
  loadAllArtists: h.loadAllArtists,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      upsert: vi.fn(() => ({
        then: vi.fn(async (cb: (r: { error: null }) => void) => cb({ error: null })),
      })),
    })),
  })),
}));

import { resolveArtistName } from "../resolve-artist";

beforeEach(() => {
  h.fetchArtistCards.mockReset();
  h.loadAllArtists.mockReset();
  // 默认本地名单为空 → 走 Scryfall 精确查兜底
  h.loadAllArtists.mockResolvedValue([]);
});

function makeCards(names: string[]) {
  return names.map((name) => ({
    name,
    set: "LEA",
    set_name: "Alpha",
    collector_number: "1",
    image_url: null,
    released_at: "1993-08-05",
  }));
}

describe("resolveArtistName", () => {
  it("本地名单精确命中（大小写变体）：返回标准名，不打 Scryfall", async () => {
    h.loadAllArtists.mockResolvedValue(["John Avon"]);

    const result = await resolveArtistName("john avon");

    expect(result).toBe("John Avon");
    expect(h.fetchArtistCards).not.toHaveBeenCalled();
  });

  it("本地名单模糊命中（编辑距离 ≤1）：返回标准名，不打 Scryfall", async () => {
    h.loadAllArtists.mockResolvedValue(["Sergey Glushakov"]);

    const result = await resolveArtistName("Sergiy Glushakov");

    expect(result).toBe("Sergey Glushakov");
    expect(h.fetchArtistCards).not.toHaveBeenCalled();
  });

  it("本地名单未命中：回退 Scryfall 精确查询", async () => {
    h.loadAllArtists.mockResolvedValue(["Someone Else"]);
    h.fetchArtistCards.mockResolvedValue({ cards: makeCards(["Forest"]), complete: true });

    const result = await resolveArtistName("John Avon");

    expect(result).toBe("John Avon");
    expect(h.fetchArtistCards).toHaveBeenCalledTimes(1);
  });

  it("精确查命中 + 大小写变体：提取 Scryfall 标准名", async () => {
    h.fetchArtistCards.mockResolvedValue({
      cards: [
        {
          name: "Forest",
          set: "LEA",
          set_name: "Alpha",
          collector_number: "1",
          image_url: null,
          released_at: "1993-08-05",
          artist: "John Avon",
        },
      ],
      complete: true,
    });

    const result = await resolveArtistName("john avon");

    expect(result).toBe("John Avon");
  });

  it("本地未命中 + Scryfall 也查不到：返回 null", async () => {
    h.fetchArtistCards.mockResolvedValue({ cards: [], complete: true });

    const result = await resolveArtistName("Xyz Abcdefg");

    expect(result).toBeNull();
  });
});
