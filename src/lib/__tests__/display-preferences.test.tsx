// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDisplayMode } from "../display-mode";
import { useDeckLayout } from "../deck-layout";

// ═════════════════════════════════════════════════════════════
// 显示偏好 Hook 测试
//
// 覆盖 localStorage 持久化、默认值、切换逻辑。
// 这些 Hook 曾因 SSR hydration mismatch 被重构，测试确保行为稳定。
// ═════════════════════════════════════════════════════════════

describe("useDisplayMode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("默认返回 grouped（避免 hydration mismatch）", () => {
    const { result } = renderHook(() => useDisplayMode());
    expect(result.current.mode).toBe("grouped");
  });

  it("挂载后从 localStorage 恢复用户偏好", () => {
    localStorage.setItem("mtg-card-display-mode", "individual");
    const { result } = renderHook(() => useDisplayMode());
    expect(result.current.mode).toBe("individual");
  });

  it("toggle 在 grouped 和 individual 之间切换", () => {
    const { result } = renderHook(() => useDisplayMode());

    act(() => result.current.toggle());
    expect(result.current.mode).toBe("individual");
    expect(localStorage.getItem("mtg-card-display-mode")).toBe("individual");

    act(() => result.current.toggle());
    expect(result.current.mode).toBe("grouped");
    expect(localStorage.getItem("mtg-card-display-mode")).toBe("grouped");
  });

  it("忽略 localStorage 中的非法值", () => {
    localStorage.setItem("mtg-card-display-mode", "invalid");
    const { result } = renderHook(() => useDisplayMode());
    expect(result.current.mode).toBe("grouped");
  });
});

describe("useDeckLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("默认返回 default（避免 hydration mismatch）", () => {
    const { result } = renderHook(() => useDeckLayout());
    expect(result.current.layout).toBe("default");
  });

  it("挂载后从 localStorage 恢复用户偏好", () => {
    localStorage.setItem("mtg-deck-layout", "compact");
    const { result } = renderHook(() => useDeckLayout());
    expect(result.current.layout).toBe("compact");
  });

  it("cycle 按 default → compact → list → default 循环", () => {
    const { result } = renderHook(() => useDeckLayout());

    act(() => result.current.cycle());
    expect(result.current.layout).toBe("compact");
    expect(localStorage.getItem("mtg-deck-layout")).toBe("compact");

    act(() => result.current.cycle());
    expect(result.current.layout).toBe("list");
    expect(localStorage.getItem("mtg-deck-layout")).toBe("list");

    act(() => result.current.cycle());
    expect(result.current.layout).toBe("default");
    expect(localStorage.getItem("mtg-deck-layout")).toBe("default");
  });

  it("setLayout 直接设置并持久化", () => {
    const { result } = renderHook(() => useDeckLayout());

    act(() => result.current.setLayout("list"));
    expect(result.current.layout).toBe("list");
    expect(localStorage.getItem("mtg-deck-layout")).toBe("list");
  });

  it("忽略 localStorage 中的非法值", () => {
    localStorage.setItem("mtg-deck-layout", "grid");
    const { result } = renderHook(() => useDeckLayout());
    expect(result.current.layout).toBe("default");
  });
});
