import { NavBar } from "@/components/nav-bar";
import { AnnouncementBanner } from "@/components/announcement-banner";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
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
