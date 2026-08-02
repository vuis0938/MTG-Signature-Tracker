import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { AdminNav } from "@/components/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const userName = cookieStore.get("user_name")?.value;

  if (!userName || !isAdmin(userName)) {
    redirect("/decks");
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-muted/30">
      <AdminNav />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        {children}
      </main>
    </div>
  );
}
