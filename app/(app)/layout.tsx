import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { UIProvider } from "@/components/UIProvider";
import { SessionProvider } from "@/components/SessionProvider";
import CommandPalette from "@/components/CommandPalette";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import FindBillDialog from "@/components/FindBillDialog";
import PageTransition from "@/components/PageTransition";

// Wraps every signed-in page in the persistent rail + top bar. Because this
// is a layout, they stay mounted across client-side navigation - no
// re-fetching identity on every click, no flicker.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UIProvider>
      <SessionProvider>
        <a href="#main-content" className="skip-link">Skip to content</a>
        <div className="shell">
          <Sidebar />
          <div className="shell-main">
            <TopBar />
            <main className="shell-content" id="main-content" tabIndex={-1}>
              <PageTransition>{children}</PageTransition>
            </main>
          </div>
        </div>
        <CommandPalette />
        <FindBillDialog />
        <ShortcutsHelp />
      </SessionProvider>
    </UIProvider>
  );
}
