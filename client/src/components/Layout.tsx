import { useLocation } from "wouter";
import { Shield, UploadCloud, ClipboardList, Eye } from "lucide-react";

const NAV_ITEMS = [
  { path: "/upload", label: "Upload Report", icon: UploadCloud, testId: "nav-upload" },
  { path: "/", label: "Violation Analysis", icon: ClipboardList, testId: "nav-manual" },
  { path: "/profile", label: "Profile Overview", icon: Eye, testId: "nav-profile" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location === "/" || location.startsWith("/scan/") || location.startsWith("/review/");
    return location === path;
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-64 border-r border-border bg-white flex flex-col flex-shrink-0 sticky top-0 h-screen">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <Shield className="text-primary w-6 h-6" />
          <h1 className="font-display font-bold text-xl tracking-wider text-foreground">
            LEXA
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              data-testid={item.testId}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${
                isActive(item.path)
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gray-50/50">
        {children}
      </main>
    </div>
  );
}
