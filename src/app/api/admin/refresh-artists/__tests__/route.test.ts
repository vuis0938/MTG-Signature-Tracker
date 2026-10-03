import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ═════════════════════════════════════════════════════════════
// refresh-artists 路由测试
//
// 覆盖：
// 1. 未登录 → 401；非管理员 → 403
// 2. 成功：拉 catalog → 写库 → 返回 count
// 3. catalog 为空 → 502
// 4. 写库失败 → 500
// ═════════════════════════════════════════════════════════════

const h = vi.hoisted(() => ({
  adminError: null as NextResponse | null,
  adminUser: "admin" as string | null,
  catalogResult: [] as string[],
  upsertError: null as { message: string } | null,
}));

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(() =>
    h.adminError
      ? { userName: null, error: h.adminError }
      : { userName: h.adminUser, error: null }
  ),
  logAdminAction: vi.fn(async () => {}),
}));

vi.mock("@/lib/artists-catalog", () => ({
  fetchScryfallArtistCatalog: vi.fn(async () => h.catalogResult),
  invalidateArtistsCache: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      upsert: vi.fn(async () => ({ error: h.upsertError })),
    })),
  })),
}));

import { POST } from "../route";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/admin/refresh-artists", {
    method: "POST",
  });
}

beforeEach(() => {
  h.adminError = null;
  h.adminUser = "admin";
  h.catalogResult = [];
  h.upsertError = null;
});

describe("refresh-artists", () => {
  it("未登录：401", async () => {
    h.adminError = NextResponse.json({ error: "未登录" }, { status: 401 });

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
  });

  it("非管理员：403", async () => {
    h.adminError = NextResponse.json({ error: "无权执行此操作" }, { status: 403 });

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
  });

  it("成功：拉取名单并写入，返回 count", async () => {
    h.catalogResult = ["John Avon", "Rebecca Guay"];

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
  });

  it("catalog 为空：502", async () => {
    h.catalogResult = [];

    const res = await POST(makeRequest());

    expect(res.status).toBe(502);
  });

  it("写库失败：500", async () => {
    h.catalogResult = ["John Avon"];
    h.upsertError = { message: "boom" };

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
  });
});
