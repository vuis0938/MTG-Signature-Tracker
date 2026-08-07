// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(),
  isAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase", () => {
  const getSupabase = vi.fn();
  return { getSupabase };
});

function createAdminClient(insertResult: { error: { message: string } | null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler = vi.fn(() => chain);
  chain.from = handler;
  chain.insert = handler;
  chain.then = vi.fn((cb: (result: unknown) => unknown) =>
    Promise.resolve(cb(insertResult))
  );
  return chain;
}

async function loadAdminModule() {
  return import("@/lib/admin");
}

function makeRequest() {
  return { cookies: { get: vi.fn() } } as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("requireAdmin", () => {
  it("未登录时返回 401", async () => {
    const { getUserFromRequest } = await import("@/lib/auth");
    vi.mocked(getUserFromRequest).mockResolvedValue(null);

    const { requireAdmin } = await loadAdminModule();
    const result = await requireAdmin(makeRequest());

    expect(result.userName).toBeNull();
    expect(result.error).toBeInstanceOf(Response);
    expect(result.error!.status).toBe(401);
    expect(await result.error!.json()).toEqual({ error: "未登录" });
  });

  it("已登录但非管理员时返回 403", async () => {
    const { getUserFromRequest, isAdmin } = await import("@/lib/auth");
    vi.mocked(getUserFromRequest).mockResolvedValue("alice");
    vi.mocked(isAdmin).mockReturnValue(false);

    const { requireAdmin } = await loadAdminModule();
    const result = await requireAdmin(makeRequest());

    expect(result.userName).toBeNull();
    expect(result.error).toBeInstanceOf(Response);
    expect(result.error!.status).toBe(403);
    expect(await result.error!.json()).toEqual({ error: "无权执行此操作" });
  });

  it("管理员返回用户名", async () => {
    const { getUserFromRequest, isAdmin } = await import("@/lib/auth");
    vi.mocked(getUserFromRequest).mockResolvedValue("admin");
    vi.mocked(isAdmin).mockReturnValue(true);

    const { requireAdmin } = await loadAdminModule();
    const result = await requireAdmin(makeRequest());

    expect(result.userName).toBe("admin");
    expect(result.error).toBeNull();
  });
});

describe("logAdminAction", () => {
  it("成功写入审计日志", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const client = createAdminClient({ error: null });
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    const { logAdminAction } = await loadAdminModule();
    await expect(
      logAdminAction("admin", "event_create", "event-1", { foo: "bar" })
    ).resolves.toBeUndefined();

    expect(client.from).toHaveBeenCalledWith("admin_logs");
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_user: "admin",
        action: "event_create",
        target: "event-1",
        detail: { foo: "bar" },
      })
    );
  });

  it("写入失败时静默处理并记录错误", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createAdminClient({ error: { message: "db error" } });
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    const { logAdminAction } = await loadAdminModule();
    await expect(
      logAdminAction("admin", "cache_clear_all")
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });

  it("异常时静默处理", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getSupabase).mockImplementation(() => {
      throw new Error("supabase down");
    });

    const { logAdminAction } = await loadAdminModule();
    await expect(
      logAdminAction("admin", "user_delete", "user-1")
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });
});
