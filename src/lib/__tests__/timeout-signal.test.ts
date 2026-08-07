import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTimeoutSignal, combineSignals } from "../timeout-signal";

const hasNativeTimeout =
  typeof AbortSignal !== "undefined" &&
  typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout === "function";

describe("createTimeoutSignal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("返回一个 AbortSignal", () => {
    const { signal, clear } = createTimeoutSignal(1000);
    expect(signal).toBeInstanceOf(AbortSignal);
    clear();
  });

  it("超时后自动 abort", async () => {
    const { signal, clear } = createTimeoutSignal(50);
    expect(signal.aborted).toBe(false);

    if (hasNativeTimeout) {
      // 原生 AbortSignal.timeout 使用真实定时器，fake timers 无法控制
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 100));
    } else {
      vi.advanceTimersByTime(100);
    }

    expect(signal.aborted).toBe(true);
    clear();
  });

  it("clear 后不会 abort（polyfill 路径）", () => {
    if (hasNativeTimeout) {
      // 原生 timeout 无法取消，此测试只在 polyfill 路径下有意义
      return;
    }
    const { signal, clear } = createTimeoutSignal(1000);
    clear();
    vi.advanceTimersByTime(2000);
    expect(signal.aborted).toBe(false);
  });
});

describe("combineSignals", () => {
  it("组合多个 signal，任一触发即触发", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const { signal, clear } = combineSignals([c1.signal, c2.signal]);
    expect(signal.aborted).toBe(false);
    c1.abort();
    expect(signal.aborted).toBe(true);
    clear();
  });

  it("传入已 abort 的 signal 立即触发", () => {
    const c1 = new AbortController();
    c1.abort();
    const c2 = new AbortController();
    const { signal, clear } = combineSignals([c1.signal, c2.signal]);
    expect(signal.aborted).toBe(true);
    clear();
  });

  it("空数组返回未 abort 的 signal", () => {
    const { signal, clear } = combineSignals([]);
    expect(signal.aborted).toBe(false);
    clear();
  });

  it("单 signal 直接复用", () => {
    const c = new AbortController();
    const { signal, clear } = combineSignals([c.signal]);
    expect(signal).toBe(c.signal);
    clear();
  });
});
