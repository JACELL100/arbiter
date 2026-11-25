import { ProfileProvider } from "@/components/profile-provider";
import { AppSidebar } from "@/components/app-sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProfileProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <div className="md:sticky md:top-0 md:h-screen">
          <AppSidebar />
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </ProfileProvider>
  );
}
