import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "MTG 签绘管家",
    description:
      "万智牌签绘管理工具 — 导入套牌，匹配活动画家，追踪签绘进度。",
  };
}

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const userName = await verifyToken(token);

  // 已登录用户直接进入套牌管理，未登录用户直接跳转到登录页
  if (userName) {
    redirect("/decks");
  }

  redirect("/login");
}
