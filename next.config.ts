import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // staleTimes 是 experimental 特性，必须放在 experimental 下才生效。
  // 之前放在顶层导致配置被忽略，动态页面 RSC 缓存时间为 0（每次导航都需服务端往返）。
  // RootLayout 使用 cookies() 使所有页面动态渲染，
  // 设置 300 秒缓存使来回切换页面时从缓存瞬时显示，SWR 后台静默刷新确保数据最新。
  experimental: {
    staleTimes: {
      dynamic: 300,
    },
  },
  images: {
    // 卡牌图片来自 Scryfall CDN，配置 remotePatterns 允许 next/image 优化
    remotePatterns: [
      { protocol: "https", hostname: "cards.scryfall.io" },
      { protocol: "https", hostname: "**.scryfall.io" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.scryfall.com",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
