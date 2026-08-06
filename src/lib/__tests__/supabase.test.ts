// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createClientMock = vi.fn(() => ({ mockClient: true }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

describe("getSupabase", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("缺少 URL 时抛出错误", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const { getSupabase } = await import("@/lib/supabase");
    expect(() => getSupabase()).toThrow("Missing NEXT_PUBLIC_SUPABASE_URL");
  });

  it("生产环境缺少 SERVICE_ROLE_KEY 时抛出错误", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const { getSupabase } = await import("@/lib/supabase");
    expect(() => getSupabase()).toThrow(
      "Missing SUPABASE_SERVICE_ROLE_KEY in production"
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("开发环境缺少 SERVICE_ROLE_KEY 时降级使用 ANON_KEY", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const { getSupabase } = await import("@/lib/supabase");
    getSupabase();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "anon-key",
      expect.any(Object)
    );
  });

  it("配置 SERVICE_ROLE_KEY 时优先使用", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    const { getSupabase } = await import("@/lib/supabase");
    getSupabase();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "service-key",
      expect.any(Object)
    );
  });
});
