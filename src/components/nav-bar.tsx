"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Layers,
  GitCompare,
  Calendar,
  Settings,
  Palette,
  ShieldCheck,
} from "lucide-react";

const navItems = [
  {
    href: "/decks",
    label: "套牌",
    icon: Layers,
  },
  {
    href: "/match",
    label: "匹配",
    icon: GitCompare,
  },
  {
    href: "/events",
    label: "活动",
    icon: Calendar,
  },
  {
    href: "/settings",
    label: "设置",
    icon: Settings,
  },
] as const;

export function NavBar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();

  // 合并管理员入口
  const items = isAdmin
    ? [...navItems, { href: "/admin", label: "管理", icon: ShieldCheck } as const]
    : navItems;

  return (
    <>
      {/* 桌面端：顶部导航 */}
      <header className="hidden md:flex h-14 items-center gap-4 border-b bg-background px-6 sticky top-0 z-50">
        <Link href="/decks" className="flex items-center gap-2 font-semibold">
          <Palette className="h-5 w-5 text-primary" />
          MTG 签绘管家
        </Link>
        <nav className="flex items-center gap-1 ml-4">
          {items.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* 移动端：底部导航 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background">
        <div className="flex items-center justify-around h-14">
          {items.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-xs">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
