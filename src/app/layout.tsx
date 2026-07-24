import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTG 签绘管家",
  description: "万智牌签绘管理工具 — 导入套牌，匹配活动画家",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
