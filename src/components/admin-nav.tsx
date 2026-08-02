"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Users, ScrollText, Tag, ArrowLeft, Calendar, Database, UserCheck } from "lucide-react";

const adminNavItems = [
  { href: "/admin/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { href: "/admin/users", label: "用户管理", icon: Users },
  { href: "/admin/events", label: "活动管理", icon: Calendar },
  { href: "/admin/artists", label: "画家别名", icon: UserCheck },
  { href: "/admin/cache", label: "缓存管理", icon: Database },
  { href: "/admin/audit-log", label: "审计日志", icon: ScrollText },
  { href: "/verify", label: "策展管理", icon: Tag },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <>
      {/* 桌面端：左侧侧边栏 */}
      <aside className="hidden md:flex flex-col w-56 border-r bg-background shrink-0">
        <div className="px-5 py-5 border-b">
          <h1 className="text-base font-semibold">管理后台</h1>
          <p className="text-xs text-muted-foreground mt-0.5">MTG 签绘管家</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {adminNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t">
          <Link
            href="/decks"
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
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            主站
          </Link>
        </div>
        <nav className="flex items-center gap-1 px-2 pb-2 overflow-x-auto">
          {adminNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground",
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
