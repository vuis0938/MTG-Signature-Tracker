// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, mutate as globalMutate } from "swr";
import { useDecks, refreshDecks } from "../swr-hooks";

// ═════════════════════════════════════════════════════════════
// 跨页面状态同步测试
//
// 背景：匹配页修改卡牌状态后，需要让套牌页的统计/状态立即同步。
// 实现机制：
//   1. useDecks 的 SWR key 固定为 /api/decks，decks 页和 match 页共享同一份缓存
//   2. useDecks 开启 revalidateOnMount，页面切换时自动重新验证
//   3. match 页在 PATCH /api/cards 成功后调用 refreshDecks() 主动刷新共享缓存
// 这些测试确保上述机制的关键契约不 regress。
// ═════════════════════════════════════════════════════════════

vi.mock("swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("swr")>();
  return {
    ...actual,
    mutate: vi.fn((key: string) => actual.mutate(key)),
  };
});

function createWrapper(cache: Map<string, unknown>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => cache as unknown as import("swr").Cache, dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    );
  };
}

describe("useDecks", () => {
  let cache: Map<string, unknown>;

  beforeEach(() => {
    cache = new Map();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("使用 /api/decks 作为共享缓存 key", async () => {
    const mockResponse = { success: true, decks: [], stats: {} };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const { result } = renderHook(() => useDecks(), {
      wrapper: createWrapper(cache),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(global.fetch).toHaveBeenCalledWith("/api/decks");
    expect(result.current.decks).toEqual([]);
    expect(result.current.stats).toEqual({});
  });

  it("挂载时自动重新验证（revalidateOnMount = true）", async () => {
    const mockResponse = { success: true, decks: [], stats: {} };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const { unmount, result } = renderHook(() => useDecks(), {
      wrapper: createWrapper(cache),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // 模拟从 match 页切回 decks 页：hook 重新挂载时应再次请求
    unmount();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );
    renderHook(() => useDecks(), { wrapper: createWrapper(cache) });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it("不阻断错误时的降级返回", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network error")
    );

    const { result } = renderHook(() => useDecks(), {
      wrapper: createWrapper(cache),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.decks).toEqual([]);
    expect(result.current.stats).toEqual({});
    expect(result.current.error).toBeDefined();
  });
});

describe("refreshDecks", () => {
  it("调用 mutate('/api/decks') 刷新共享缓存", async () => {
    await refreshDecks();

    expect(globalMutate).toHaveBeenCalledWith("/api/decks");
  });
});
