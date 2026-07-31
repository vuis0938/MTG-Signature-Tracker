import { NavBar } from "@/components/nav-bar";

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
        {children}
      </main>
    </div>
  );
}
