import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ═════════════════════════════════════════════════════════════
// Cards API PATCH 路由测试
//
// 主要验证：
// 1. event_name 超 200 字符返回"活动名称过长"
// 2. 多选活动场景下 event_name 不应被拼接写入
// ═════════════════════════════════════════════════════════════

// Mock 外部依赖
vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          data: null,
          error: null,
        })),
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: null,
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(() => "test-user"),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true })),
  getClientIP: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/touch-deck", () => ({
  touchDeck: vi.fn(),
  touchDecks: vi.fn(),
}));

import { PATCH, GET } from "../route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/cards", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("Cards API PATCH", () => {
  it("event_name 长度 ≤ 200 时正常通过", async () => {
    const name = "A".repeat(200);
    const res = await PATCH(makeRequest({
      cardId: "card-1",
      status: 3,
      event_name: name,
    }));
    const body = await res.json();
    // 由于 mock 的 supabase 未返回数据，会走到归属校验失败的分支
    // 但不会触发"活动名称过长"
    expect(body.error).not.toBe("活动名称过长");
  });

  it("event_name 长度 > 200 时返回「活动名称过长」", async () => {
    const name = "A".repeat(201);
    const res = await PATCH(makeRequest({
      cardId: "card-1",
      status: 3,
      event_name: name,
    }));
    const body = await res.json();
    expect(body.error).toBe("活动名称过长");
    expect(res.status).toBe(400);
  });

  it("多选活动拼接场景：三个中文活动名用顿号拼接超 200 字符", async () => {
    // 模拟多选活动拼接：每个名字约 17 字符，15 个活动拼接约 269 字符
    const names = Array.from({ length: 15 }, (_, i) =>
      `第${i + 1}届万智牌大奖赛北京站签绘活动`
    );
    const joined = names.join("、");
    // 验证拼接后确实超过 200
    expect(joined.length).toBeGreaterThan(200);

    const res = await PATCH(makeRequest({
      cardId: "card-1",
      status: 3,
      event_name: joined,
    }));
    const body = await res.json();
    expect(body.error).toBe("活动名称过长");
    expect(res.status).toBe(400);
  });

  it("event_name 为空字符串时转为 null，不触发校验", async () => {
    const res = await PATCH(makeRequest({
      cardId: "card-1",
      status: 3,
      event_name: "",
    }));
    const body = await res.json();
    expect(body.error).not.toBe("活动名称过长");
  });

  it("event_name 为 null 时不触发校验", async () => {
    const res = await PATCH(makeRequest({
      cardId: "card-1",
      status: 3,
      event_name: null,
    }));
    const body = await res.json();
    expect(body.error).not.toBe("活动名称过长");
  });

  it("event_name 不传时不触发校验", async () => {
    const res = await PATCH(makeRequest({
      cardId: "card-1",
      status: 3,
    }));
    const body = await res.json();
    expect(body.error).not.toBe("活动名称过长");
  });
});