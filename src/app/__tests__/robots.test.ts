import { describe, it, expect, beforeEach, afterEach } from "vitest";
import robots from "@/app/robots";

describe("robots.ts", () => {
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
    const result = robots();
    expect(result.sitemap).toBe("https://www.mtgkit.top/sitemap.xml");
    expect(result.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/decks", "/match", "/events", "/settings", "/login"],
    });
  });

  it("支持通过 NEXT_PUBLIC_SITE_URL 覆盖域名", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    const result = robots();
    expect(result.sitemap).toBe("https://example.com/sitemap.xml");
  });
});
