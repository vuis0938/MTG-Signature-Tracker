import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sitemap from "@/app/sitemap";

describe("sitemap.ts", () => {
  const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
    }
  });

  it("默认使用 canonical 生产域名 www.mtgkit.top", () => {
    const result = sitemap();
    const urls = result.map((item) => item.url);

    expect(urls).toContain("https://www.mtgkit.top/");
    expect(urls).toContain("https://www.mtgkit.top/privacy");
    expect(urls).toContain("https://www.mtgkit.top/terms");
  });

  it("不包含需登录的页面（会被 middleware 重定向）", () => {
    const result = sitemap();
    const paths = result.map((item) => new URL(item.url).pathname);

    expect(paths).not.toContain("/decks");
    expect(paths).not.toContain("/match");
    expect(paths).not.toContain("/events");
    expect(paths).not.toContain("/settings");
    expect(paths).not.toContain("/login");
  });

  it("支持通过 NEXT_PUBLIC_SITE_URL 覆盖域名", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    const result = sitemap();
    expect(result[0].url).toBe("https://example.com/");
  });

  it("包含关键的公开页面", () => {
    const result = sitemap();
    const paths = result.map((item) => new URL(item.url).pathname);

    expect(paths).toContain("/");
    expect(paths).toContain("/privacy");
    expect(paths).toContain("/terms");
  });
});
