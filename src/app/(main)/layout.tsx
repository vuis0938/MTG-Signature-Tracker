import { cookies } from "next/headers";
import { NavBar } from "@/components/nav-bar";
import { AnnouncementBanner } from "@/components/announcement-banner";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 服务端读取 is_admin cookie，消除管理员入口闪烁
  // 注意：不在此处获取公告数据，避免 Supabase 查询阻塞所有页面渲染
  // 公告由 AnnouncementBanner 通过 SWR 客户端获取（有跨页面缓存）
  const cookieStore = await cookies();
  const isAdmin = cookieStore.get("is_admin")?.value === "true";

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar isAdmin={isAdmin} />
      {/* pb-16 for mobile bottom nav bar */}
      <main className="flex-1 container max-w-6xl mx-auto px-4 md:px-6 lg:px-8 py-6 pb-20 md:pb-6">
        <div className="mb-4">
          <AnnouncementBanner />
        </div>
        {children}
      </main>
    </div>
  );
}
