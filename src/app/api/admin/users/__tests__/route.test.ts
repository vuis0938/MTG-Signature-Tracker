import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ═════════════════════════════════════════════════════════════
// admin users 路由测试（GET 列表）
//
// 覆盖：
// 1. 未登录 → 401；非管理员 → 403
// 2. 成功：从 user_stats 视图映射字段
// 3. 查询失败 → 500
// ═════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  adminError: null as NextResponse | null,
  adminUser: "admin" as string | null,
  rows: [] as Array<Record<string, unknown>>,
  queryError: null as { message: string } | null,
}));

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(() =>
    h.adminError
      ? { userName: null, error: h.adminError }
      : { userName: h.adminUser, error: null }
  ),
  logAdminAction: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => ({ data: h.rows, error: h.queryError })),
      })),
    })),
  })),
}));

import { GET } from "../route";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/admin/users", { method: "GET" });
}

beforeEach(() => {
  h.adminError = null;
  h.adminUser = "admin";
  h.rows = [];
  h.queryError = null;
});

describe("admin users list", () => {
  it("未登录：401", async () => {
    h.adminError = NextResponse.json({ error: "未登录" }, { status: 401 });

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
  });

  it("非管理员：403", async () => {
    h.adminError = NextResponse.json({ error: "无权执行此操作" }, { status: 403 });

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
  });

  it("成功：从视图映射套牌数/卡牌数", async () => {
    h.rows = [
      {
        username: "alice",
        created_at: "2026-01-01",
        last_active_at: null,
        deck_count: 2,
        card_count: 200,
      },
      {
        username: "bob",
        created_at: "2026-01-02",
        last_active_at: "2026-02-01",
        deck_count: 0,
        card_count: 0,
      },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.total).toBe(2);
    expect(body.users[0]).toEqual({
      username: "alice",
      createdAt: "2026-01-01",
      lastActiveAt: null,
      deckCount: 2,
      cardCount: 200,
    });
    expect(body.users[1].cardCount).toBe(0);
  });

  it("查询失败：500", async () => {
    h.queryError = { message: "boom" };

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
  });
});
