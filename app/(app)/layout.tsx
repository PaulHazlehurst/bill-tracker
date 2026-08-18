import Sidebar from "@/components/Sidebar";
import { UIProvider } from "@/components/UIProvider";
import CommandPalette from "@/components/CommandPalette";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import PageTransition from "@/components/PageTransition";
import CapitolWatermark from "@/components/CapitolWatermark";
import VersionBadge from "@/components/VersionBadge";

// Wraps every authenticated page (dashboard, team, activity, settings, bill
// detail) in a persistent sidebar. Because this is a layout, not a page,
// Sidebar stays mounted across client-side navigation between these routes -
// no re-fetching your org/logo on every click, no flicker.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UIProvider>
      <div className="top-accent-bar" />
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">
          <CapitolWatermark />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <CommandPalette />
      <ShortcutsHelp />
      <VersionBadge />
    </UIProvider>
  );
}
