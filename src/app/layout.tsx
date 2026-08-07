import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.mtgkit.top";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "MTG 签绘管家",
    template: "%s - MTG 签绘管家",
  },
  description:
    "万智牌签绘管理工具 — 导入套牌，匹配活动画家，追踪签绘进度。",
  keywords: [
    "万智牌",
    "MTG",
    "签绘",
    "画家",
    "套牌管理",
    "Magic: The Gathering",
    "签名",
  ],
  authors: [{ name: "MTG 签绘管家" }],
  creator: "MTG 签绘管家",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: "MTG 签绘管家",
    title: "MTG 签绘管家",
    description:
      "万智牌签绘管理工具 — 导入套牌，匹配活动画家，追踪签绘进度。",
  },
  twitter: {
    card: "summary_large_image",
    title: "MTG 签绘管家",
    description:
      "万智牌签绘管理工具 — 导入套牌，匹配活动画家，追踪签绘进度。",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
