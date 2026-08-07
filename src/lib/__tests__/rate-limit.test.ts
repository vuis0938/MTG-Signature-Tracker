import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { rateLimit, getClientIP } from "../rate-limit";

// ═════════════════════════════════════════════════════════════
// rateLimit
// ═════════════════════════════════════════════════════════════

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("首次请求允许通过", () => {
    const result = rateLimit("test:key", 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("未超限时逐次递减剩余次数", () => {
    rateLimit("test:decrement", 3, 60_000);
    const second = rateLimit("test:decrement", 3, 60_000);
    expect(second.remaining).toBe(1);

    const third = rateLimit("test:decrement", 3, 60_000);
    expect(third.remaining).toBe(0);
    expect(third.allowed).toBe(true);
  });

  it("超过最大次数后拒绝", () => {
    const key = "test:blocked";
    const max = 3;
    for (let i = 0; i < max; i++) {
      const r = rateLimit(key, max, 60_000);
      expect(r.allowed).toBe(true);
    }
    const over = rateLimit(key, max, 60_000);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("时间窗口过后重置计数", () => {
    const key = "test:reset";
    rateLimit(key, 2, 60_000);
    rateLimit(key, 2, 60_000);
    // 超限
    const blocked = rateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);

    // 前进 61 秒，窗口过期
    vi.advanceTimersByTime(61_000);
    const after = rateLimit(key, 2, 60_000);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(1);
  });

  it("不同 key 互不影响", () => {
    rateLimit("key:a", 1, 60_000);
    const blockedA = rateLimit("key:a", 1, 60_000);
    expect(blockedA.allowed).toBe(false);

    const b = rateLimit("key:b", 1, 60_000);
    expect(b.allowed).toBe(true);
  });

  it("resetAt 返回正确的过期时间戳", () => {
    const now = Date.now();
    const result = rateLimit("test:resetat", 5, 10_000);
    expect(result.resetAt).toBe(now + 10_000);
  });

  it("窗口内多次请求 resetAt 保持不变", () => {
    const key = "test:consistent-resetat";
    const first = rateLimit(key, 5, 10_000);
    vi.advanceTimersByTime(3_000);
    const second = rateLimit(key, 5, 10_000);
    expect(second.resetAt).toBe(first.resetAt);
  });
});

// ═════════════════════════════════════════════════════════════
// getClientIP
// ═════════════════════════════════════════════════════════════

describe("getClientIP", () => {
  it("从 x-forwarded-for 提取第一个 IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    expect(getClientIP({ headers })).toBe("1.2.3.4");
  });

  it("x-forwarded-for 不存在时回退到 x-real-ip", () => {
    const headers = new Headers({
      "x-real-ip": "9.10.11.12",
    });
    expect(getClientIP({ headers })).toBe("9.10.11.12");
  });

  it("两个头都不存在时返回 unknown", () => {
    const headers = new Headers();
    expect(getClientIP({ headers })).toBe("unknown");
  });

  it("x-forwarded-for 有前后空格时正确 trim", () => {
    const headers = new Headers({
      "x-forwarded-for": "  1.2.3.4  , 5.6.7.8",
    });
    expect(getClientIP({ headers })).toBe("1.2.3.4");
  });
});
