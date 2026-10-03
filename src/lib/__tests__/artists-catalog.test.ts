import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ═════════════════════════════════════════════════════════════
// artists-catalog 测试
//
// 覆盖：
// 1. loadAllArtists：读库成功 / 非空缓存 / 空结果不缓存 / 读库报错
// 2. 分页拉全（绕过 Supabase db-max-rows=1000 的静默截断）
// 3. invalidateArtistsCache：清缓存后重新读库
// 4. fetchScryfallArtistCatalog：成功去重 / 非 2xx 抛异常
// ═════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  range: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          range: h.range,
        })),
      })),
    })),
  })),
}));

import { loadAllArtists, fetchScryfallArtistCatalog, invalidateArtistsCache } from "../artists-catalog";

beforeEach(() => {
  h.range.mockReset();
  invalidateArtistsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadAllArtists", () => {
  it("读库成功：返回名单", async () => {
    h.range.mockResolvedValue({
      data: [{ name: "John Avon" }, { name: "Rebecca Guay" }],
      error: null,
    });

    const result = await loadAllArtists();

    expect(result).toEqual(["John Avon", "Rebecca Guay"]);
    expect(h.range).toHaveBeenCalledTimes(1);
  });

  it("非空结果会缓存：第二次不再读库", async () => {
    h.range.mockResolvedValue({ data: [{ name: "John Avon" }], error: null });

    await loadAllArtists();
    await loadAllArtists();

    expect(h.range).toHaveBeenCalledTimes(1);
  });

  it("空结果不缓存：第二次仍重新读库", async () => {
    h.range.mockResolvedValue({ data: [], error: null });

    await loadAllArtists();
    await loadAllArtists();

    expect(h.range).toHaveBeenCalledTimes(2);
  });

  it("分页拉全：超过 1000 行时自动翻页", async () => {
    h.range
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, (_, i) => ({ name: `A${i}` })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, (_, i) => ({ name: `B${i}` })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 439 }, (_, i) => ({ name: `C${i}` })),
        error: null,
      });

    const result = await loadAllArtists();

    expect(result).toHaveLength(2439);
    expect(h.range).toHaveBeenCalledTimes(3);
    // 验证翻页的 range 偏移：0-999、1000-1999、2000-2999
    expect(h.range.mock.calls[0]).toEqual([0, 999]);
    expect(h.range.mock.calls[1]).toEqual([1000, 1999]);
    expect(h.range.mock.calls[2]).toEqual([2000, 2999]);
  });

  it("读库报错：返回空数组", async () => {
    h.range.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await loadAllArtists();

    expect(result).toEqual([]);
  });

  it("invalidateArtistsCache：清缓存后重新读库", async () => {
    h.range.mockResolvedValue({ data: [{ name: "John Avon" }], error: null });

    await loadAllArtists();
    invalidateArtistsCache();
    await loadAllArtists();

    expect(h.range).toHaveBeenCalledTimes(2);
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
