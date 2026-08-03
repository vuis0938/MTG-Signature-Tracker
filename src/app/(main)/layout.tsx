import { cookies } from "next/headers";
import { NavBar } from "@/components/nav-bar";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { getAnnouncements } from "@/lib/data";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 服务端读取 is_admin cookie，消除管理员入口闪烁
  const cookieStore = await cookies();
  const isAdmin = cookieStore.get("is_admin")?.value === "true";

  // 预取公告数据作为 SSR fallback（带 5 分钟服务端缓存，不阻塞渲染）
  const announcements = await getAnnouncements();

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar isAdmin={isAdmin} />
      {/* pb-16 for mobile bottom nav bar */}
      <main className="flex-1 container max-w-6xl mx-auto px-4 md:px-6 lg:px-8 py-6 pb-20 md:pb-6">
        <div className="mb-4">
          <AnnouncementBanner fallbackAnnouncements={announcements} />
        </div>
        {children}
      </main>
    </div>
  );
}
