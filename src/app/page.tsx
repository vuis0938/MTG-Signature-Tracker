import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifyToken } from "@/lib/auth";
import { Palette, Upload, Search, Heart } from "lucide-react";
import { LandingForm } from "./landing-form";

export const metadata: Metadata = {
  description:
    "万智牌签绘收藏管理工具 — 导入套牌，匹配活动画家，追踪签绘进度。",
};

const FEATURES = [
  {
    icon: Upload,
    title: "导入套牌",
    desc: "粘贴牌表，自动识别",
  },
  {
    icon: Search,
    title: "匹配画家",
    desc: "活动画家，一键匹配",
  },
  {
    icon: Heart,
    title: "追踪进度",
    desc: "三态切换，一目了然",
  },
] as const;

export default async function Home() {
  // 已登录用户直接进入主站
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (verifyToken(token)) {
    redirect("/decks");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        {/* 标题 */}
        <header className="text-center space-y-1">
          <h1 className="text-2xl font-semibold flex items-center justify-center gap-2">
            <Palette className="h-6 w-6 text-primary" />
            MTG 签绘管家
          </h1>
          <p className="text-sm text-muted-foreground">
            万智牌签绘收藏管理工具
          </p>
          <p className="text-sm text-muted-foreground">
            导入套牌，匹配画家，追踪进度
          </p>
        </header>

        {/* 功能介绍 */}
        <section className="space-y-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-center gap-3">
              <Icon className="h-5 w-5 text-primary shrink-0" />
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
            </div>
          ))}
        </section>

        <div className="border-t" />

        {/* 登录表单 */}
        <LandingForm />

        <div className="border-t" />

        {/* 协议 */}
        <footer className="text-center text-xs text-muted-foreground">
          登录或注册即表示您同意
          <Link href="/terms" className="underline hover:text-foreground mx-1">
            用户协议
          </Link>
          和
          <Link href="/privacy" className="underline hover:text-foreground mx-1">
            隐私政策
          </Link>
        </footer>
      </div>
    </div>
  );
}
