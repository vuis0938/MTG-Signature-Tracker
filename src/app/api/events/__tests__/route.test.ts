// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60000 })),
  getClientIP: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(() => Promise.resolve("alice")),
}));

vi.mock("@/lib/events-data", () => ({
  getEvents: vi.fn(),
}));

import { GET } from "../route";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getEvents } from "@/lib/events-data";

function makeRequest(): NextRequest {
  return {
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe("/api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOKEN_SECRET", "test-secret-must-be-at-least-32-characters-long");
  });

  it("未登录返回 401", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("未登录");
  });

  it("限流触发返回 429", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("频繁");
  });

  it("数据源失败时返回空数组与 no-store", async () => {
    vi.mocked(getEvents).mockRejectedValueOnce(new Error("所有数据源均失败"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.events).toEqual([]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("正常返回活动列表并带私有缓存头", async () => {
    const events = [
      {
        id: "evt-1",
        name: "GP",
        city: "Shanghai",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
        artists: ["John Avon"],
        source: "mtgac",
      },
    ];
    vi.mocked(getEvents).mockResolvedValueOnce(events as any);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.events).toEqual(events);
    expect(res.headers.get("Cache-Control")).toContain("private");
  });
});
