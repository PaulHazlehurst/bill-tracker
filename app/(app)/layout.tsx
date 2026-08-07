import Sidebar from "@/components/Sidebar";

// Wraps every authenticated page (dashboard, team, activity, settings, bill
// detail) in a persistent sidebar. Because this is a layout, not a page,
// Sidebar stays mounted across client-side navigation between these routes -
// no re-fetching your org/logo on every click, no flicker.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">{children}</main>
    </div>
  );
}
