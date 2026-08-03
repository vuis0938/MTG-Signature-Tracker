"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Users, ScrollText, Tag, ArrowLeft, Calendar, Database, UserCheck, Megaphone, Download, MessageSquareWarning } from "lucide-react";

const adminNavItems = [
  { href: "/admin/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { href: "/admin/users", label: "用户管理", icon: Users },
  { href: "/admin/events", label: "活动管理", icon: Calendar },
  { href: "/admin/artists", label: "画家别名", icon: UserCheck },
  { href: "/admin/cache", label: "缓存管理", icon: Database },
  { href: "/admin/announcements", label: "系统公告", icon: Megaphone },
  { href: "/admin/feedback", label: "反馈管理", icon: MessageSquareWarning, badge: true },
  { href: "/admin/export", label: "数据导出", icon: Download },
  { href: "/admin/audit-log", label: "审计日志", icon: ScrollText },
  { href: "/verify", label: "策展管理", icon: Tag },
] as const;

// 未读角标超过 99 显示 99+
function formatBadge(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function AdminNav() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // 轮询未读反馈数量：每 60 秒一次，使用 head 查询返回最小数据量
  // 管理员在后台任意页面都能实时感知新反馈
  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback/unread");
      const data = await res.json();
      if (data.success) {
        setUnread(data.unread ?? 0);
      }
    } catch {
      // 静默失败，不影响导航栏使用
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    const timer = setInterval(fetchUnread, 60_000);
    // 页面重新可见时立即刷新一次
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchUnread();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchUnread]);

  // 进入反馈管理页后清零角标（页面内会自行加载并标记已读）
  useEffect(() => {
    if (pathname.startsWith("/admin/feedback")) {
      setUnread(0);
    }
  }, [pathname]);

  return (
    <>
      {/* 桌面端：左侧侧边栏 */}
      <aside className="hidden md:flex flex-col w-56 border-r bg-background shrink-0">
        <div className="px-5 py-5 border-b">
          <h1 className="text-base font-semibold">管理后台</h1>
          <p className="text-xs text-muted-foreground mt-0.5">MTG 签绘管家</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {adminNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const showBadge = "badge" in item && item.badge && unread > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors relative",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {showBadge && (
                  <span className="ml-auto min-w-5 h-5 px-1.5 inline-flex items-center justify-center text-xs font-medium rounded-full bg-red-500 text-white">
                    {formatBadge(unread)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t">
          <Link
            href="/decks"
            prefetch={true}
            className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-md transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            返回主站
          </Link>
        </div>
      </aside>

      {/* 移动端：顶部导航 */}
      <header className="md:hidden sticky top-0 z-50 border-b bg-background">
        <div className="flex items-center justify-between px-4 h-12">
          <span className="text-sm font-semibold">管理后台</span>
          <Link
            href="/decks"
            prefetch={true}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            主站
          </Link>
        </div>
        <nav className="flex items-center gap-1 px-2 pb-2 overflow-x-auto">
          {adminNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const showBadge = "badge" in item && item.badge && unread > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition-colors relative",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground",
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
                {showBadge && (
                  <span className="min-w-4 h-4 px-1 inline-flex items-center justify-center text-[10px] font-medium rounded-full bg-red-500 text-white">
                    {formatBadge(unread)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
