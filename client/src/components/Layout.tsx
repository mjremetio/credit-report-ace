import { useLocation } from "wouter";
import { BrainCircuit, UploadCloud, ClipboardList, Eye, Activity } from "lucide-react";

const NAV_ITEMS = [
  { path: "/upload", label: "Upload", icon: UploadCloud, testId: "nav-upload" },
  { path: "/", label: "Manual Workflow", icon: ClipboardList, testId: "nav-manual" },
  { path: "/profile", label: "Profile Clarity", icon: Eye, testId: "nav-profile" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location === "/" || location.startsWith("/scan/");
    return location === path;
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-64 border-r border-border bg-card flex flex-col flex-shrink-0 sticky top-0 h-screen">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <BrainCircuit className="text-primary w-6 h-6" />
          <h1 className="font-display font-bold text-xl tracking-wider text-white">
            LEXA <span className="text-primary text-sm font-mono ml-1">v2.4</span>
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <div className="text-xs font-mono text-muted-foreground mb-4 mt-2 px-2">NAVIGATION</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              data-testid={item.testId}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${
                isActive(item.path)
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-white"
              }`}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 px-2 py-3 bg-secondary rounded-md border border-border">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_hsl(var(--primary))]" />
            <span className="text-xs font-mono text-muted-foreground">ENGINE: ONLINE</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
