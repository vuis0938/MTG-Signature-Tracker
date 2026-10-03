import { describe, it, expect, vi, beforeEach } from "vitest";

// ═════════════════════════════════════════════════════════════
// resolveArtistName 测试
//
// 覆盖：
// 1. 精确命中 → 直接返回原名，不触发降级
// 2. 转写差异 → 降级查询 + 三关命中
// 3. 查不到候选 → null
// 4. 歧义候选（多个命中）→ null
// 5. 二次验证失败 → null
// ═════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  fetchArtistCards: vi.fn(),
  fetchArtistCandidates: vi.fn(),
  loadAllArtists: vi.fn(),
}));

vi.mock("@/lib/scryfall-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall-client")>();
  return {
    ...actual,
    fetchArtistCards: h.fetchArtistCards,
    fetchArtistCandidates: h.fetchArtistCandidates,
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
  h.fetchArtistCandidates.mockReset();
  h.loadAllArtists.mockReset();
  // 默认本地名单为空 → 走 Scryfall 降级，保持原有测试语义
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
  it("精确命中：直接返回原名，不触发降级", async () => {
    h.fetchArtistCards.mockResolvedValue({ cards: makeCards(["Forest"]), complete: true });

    const result = await resolveArtistName("John Avon");

    expect(result).toBe("John Avon");
    expect(h.fetchArtistCandidates).not.toHaveBeenCalled();
  });

  it("精确命中 + 大小写变体：返回 Scryfall 标准名", async () => {
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
    expect(h.fetchArtistCandidates).not.toHaveBeenCalled();
  });

  it("本地名单精确命中：返回标准名，不打 Scryfall", async () => {
    h.loadAllArtists.mockResolvedValue(["John Avon"]);

    const result = await resolveArtistName("john avon");

    expect(result).toBe("John Avon");
    expect(h.fetchArtistCards).not.toHaveBeenCalled();
    expect(h.fetchArtistCandidates).not.toHaveBeenCalled();
  });

  it("本地名单模糊命中：转写差异在本地纠错，不打 Scryfall", async () => {
    h.loadAllArtists.mockResolvedValue(["Sergey Glushakov"]);

    const result = await resolveArtistName("Sergiy Glushakov");

    expect(result).toBe("Sergey Glushakov");
    expect(h.fetchArtistCards).not.toHaveBeenCalled();
    expect(h.fetchArtistCandidates).not.toHaveBeenCalled();
  });

  it("本地名单未命中：回退 Scryfall 精确查询", async () => {
    h.loadAllArtists.mockResolvedValue(["Someone Else"]);
    h.fetchArtistCards.mockResolvedValue({ cards: makeCards(["Forest"]), complete: true });

    const result = await resolveArtistName("John Avon");

    expect(result).toBe("John Avon");
    expect(h.fetchArtistCards).toHaveBeenCalledTimes(1);
  });

  it("转写差异：降级查询 + 三关命中", async () => {
    h.fetchArtistCards
      .mockResolvedValueOnce({ cards: [], complete: true }) // 精确查空
      .mockResolvedValueOnce({ cards: makeCards(["Island"]), complete: true }); // 二次验证命中
    h.fetchArtistCandidates.mockResolvedValue(["Sergey Glushakov"]);

    const result = await resolveArtistName("Sergiy Glushakov");

    expect(result).toBe("Sergey Glushakov");
    expect(h.fetchArtistCandidates).toHaveBeenCalledTimes(1);
    expect(h.fetchArtistCandidates.mock.calls[0][0]).toBe("Glushakov");
  });

  it("查不到候选：返回 null", async () => {
    h.fetchArtistCards.mockResolvedValue({ cards: [], complete: true });
    h.fetchArtistCandidates.mockResolvedValue([]);

    const result = await resolveArtistName("Xyz Abcdefg");

    expect(result).toBeNull();
  });

  it("歧义候选（多个命中）：返回 null", async () => {
    h.fetchArtistCards.mockResolvedValueOnce({ cards: [], complete: true });
    h.fetchArtistCandidates.mockResolvedValue(["Dan Scott", "Dan Murayama Scott"]);

    const result = await resolveArtistName("Dan Scott");

    expect(result).toBeNull();
  });

  it("二次验证失败：返回 null", async () => {
    h.fetchArtistCards
      .mockResolvedValueOnce({ cards: [], complete: true }) // 精确查空
      .mockResolvedValueOnce({ cards: [], complete: true }); // 二次验证查空
    h.fetchArtistCandidates.mockResolvedValue(["Sergey Glushakov"]);

    const result = await resolveArtistName("Sergiy Glushakov");

    expect(result).toBeNull();
  });
});
