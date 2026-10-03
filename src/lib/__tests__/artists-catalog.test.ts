import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ═════════════════════════════════════════════════════════════
// artists-catalog 测试
//
// 覆盖：
// 1. loadAllArtists：读库成功 / 非空缓存 / 空结果不缓存 / 读库报错
// 2. invalidateArtistsCache：清缓存后重新读库
// 3. fetchScryfallArtistCatalog：成功去重 / 非 2xx 抛异常
// ═════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: h.select,
    })),
  })),
}));

import { loadAllArtists, fetchScryfallArtistCatalog, invalidateArtistsCache } from "../artists-catalog";

beforeEach(() => {
  h.select.mockReset();
  invalidateArtistsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadAllArtists", () => {
  it("读库成功：返回名单", async () => {
    h.select.mockResolvedValue({
      data: [{ name: "John Avon" }, { name: "Rebecca Guay" }],
      error: null,
    });

    const result = await loadAllArtists();

    expect(result).toEqual(["John Avon", "Rebecca Guay"]);
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("非空结果会缓存：第二次不再读库", async () => {
    h.select.mockResolvedValue({ data: [{ name: "John Avon" }], error: null });

    await loadAllArtists();
    await loadAllArtists();

    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("空结果不缓存：第二次仍重新读库", async () => {
    h.select.mockResolvedValue({ data: [], error: null });

    await loadAllArtists();
    await loadAllArtists();

    expect(h.select).toHaveBeenCalledTimes(2);
  });

  it("读库报错：返回空数组", async () => {
    h.select.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await loadAllArtists();

    expect(result).toEqual([]);
  });

  it("invalidateArtistsCache：清缓存后重新读库", async () => {
    h.select.mockResolvedValue({ data: [{ name: "John Avon" }], error: null });

    await loadAllArtists();
    invalidateArtistsCache();
    await loadAllArtists();

    expect(h.select).toHaveBeenCalledTimes(2);
  });
});

describe("fetchScryfallArtistCatalog", () => {
  it("成功返回去重数组（含 trim + 空串过滤）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [" John Avon ", "Rebecca Guay", "", "John Avon", "  "],
        }),
      })
    );

    const result = await fetchScryfallArtistCatalog();

    expect(result).toEqual(["John Avon", "Rebecca Guay"]);
  });

  it("非 2xx：抛异常", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );

    await expect(fetchScryfallArtistCatalog()).rejects.toThrow();
  });
});
