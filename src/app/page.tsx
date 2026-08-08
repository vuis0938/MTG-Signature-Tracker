import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifyToken } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Palette } from "lucide-react";
import { LandingForm } from "./landing-form";

export const metadata: Metadata = {
  description:
    "万智牌签绘管理工具 — 导入管理套牌，匹配活动画家，查看近期活动，实时追踪签绘。",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  // 已登录用户直接进入主站
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (verifyToken(token)) {
    redirect("/decks");
  }

  const { mode } = await searchParams;
  const validMode =
    mode === "register" || mode === "forgot" ? mode : "login";

  return (
    <div className="flex min-h-screen min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm" suppressHydrationWarning>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl flex items-center justify-center gap-2">
            <Palette className="h-6 w-6 text-primary" />
            MTG 签绘管家
          </CardTitle>
          <CardDescription>万智牌签绘管理工具</CardDescription>
        </CardHeader>
        <CardContent>
          <LandingForm initialMode={validMode} />
          <div className="mt-6 pt-4 border-t text-center text-xs text-muted-foreground">
            登录或注册即表示您同意
            <Link href="/terms" className="underline hover:text-foreground mx-1">
              用户协议
            </Link>
            和
            <Link href="/privacy" className="underline hover:text-foreground mx-1">
              隐私政策
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
