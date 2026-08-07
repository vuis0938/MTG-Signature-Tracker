import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.mtgkit.top";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/decks", "/match", "/events", "/settings", "/login"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
