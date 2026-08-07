// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { SWRConfig, mutate as globalMutate } from "swr";
import { useDecks, refreshDecks } from "../swr-hooks";

// ═════════════════════════════════════════════════════════════
// 跨页面状态同步测试
//
// 背景：匹配页修改卡牌状态后，需要让套牌页的统计/状态即时同步。
// 实现机制：
//   1. useDecks 的 SWR key 固定为 /api/decks，decks 页和 match 页共享同一份缓存
//   2. useDecks / useCards 关闭自动刷新（revalidateOnFocus/Mount/Reconnect = false）
//      避免套牌管理界面出现意外刷新；数据来自 SSR fallback 或显式更新
//   3. match 页在 PATCH /api/cards 成功后调用 refreshDecks() 主动刷新共享缓存，
//      并通过 mutateCards 乐观更新 /api/cards 缓存，套牌页无需手动刷新即可同步
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

    // 无 fallback 且关闭自动刷新，初始不会请求；手动 revalidate 触发请求
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.revalidate();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/decks", { cache: "no-store" });
    expect(result.current.decks).toEqual([]);
    expect(result.current.stats).toEqual({});
  });

  it("有 SSR fallback 时挂载不触发额外请求", async () => {
    const mockResponse = { success: true, decks: [], stats: {} };

    const { result } = renderHook(() => useDecks(mockResponse), {
      wrapper: createWrapper(cache),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // SSR 已提供数据，不应再发请求导致套牌页自动刷新
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.decks).toEqual([]);
    expect(result.current.stats).toEqual({});
  });

  it("重新挂载时不自动重新验证", async () => {
    const mockResponse = { success: true, decks: [], stats: {} };

    const { unmount, result } = renderHook(() => useDecks(mockResponse), {
      wrapper: createWrapper(cache),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 模拟从 match 页切回 decks 页：hook 重新挂载时不应再次请求
    unmount();
    renderHook(() => useDecks(mockResponse), { wrapper: createWrapper(cache) });

    // 给 SWR 一点调度时间，确认没有发起请求
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("手动 revalidate 失败时不阻断降级返回", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network error")
    );

    const { result } = renderHook(() => useDecks(), {
      wrapper: createWrapper(cache),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.revalidate();
    });

    await waitFor(() => expect(result.current.error).toBeDefined());

    expect(result.current.decks).toEqual([]);
    expect(result.current.stats).toEqual({});
  });
});

describe("refreshDecks", () => {
  it("调用 mutate('/api/decks') 刷新共享缓存", async () => {
    await refreshDecks();

    expect(globalMutate).toHaveBeenCalledWith("/api/decks");
  });
});
