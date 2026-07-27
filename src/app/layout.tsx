import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTG 签绘管家",
  description: "万智牌签绘管理工具 — 导入套牌，匹配活动画家",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const userName = cookieStore.get("user_name")?.value || "默认用户";

  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers userName={userName}>{children}</Providers>
      </body>
    </html>
  );
}
