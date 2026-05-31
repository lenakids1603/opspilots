import { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabLabels = Record<string, string>;

interface Tab {
  path: string;
  label: string;
}

interface TabsBarProps {
  labels: TabLabels;
  homePath: string;
  homeLabel: string;
  storageKey: string;
  accentClass?: string; // e.g. "border-ops-sky text-ops-navy"
}

export function TabsBar({ labels, homePath, homeLabel, storageKey, accentClass = "border-ops-sky text-ops-navy" }: TabsBarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [tabs, setTabs] = useState<Tab[]>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(tabs)); } catch {}
  }, [tabs, storageKey]);

  // Add/activate tab when route changes
  useEffect(() => {
    if (pathname === homePath) return;
    const label = labels[pathname];
    if (!label) return;
    setTabs(prev => (prev.some(t => t.path === pathname) ? prev : [...prev, { path: pathname, label }]));
  }, [pathname, homePath, labels]);

  const closeTab = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setTabs(prev => {
      const next = prev.filter(t => t.path !== path);
      if (pathname === path) {
        const idx = prev.findIndex(t => t.path === path);
        const fallback = next[idx] || next[idx - 1];
        navigate(fallback ? fallback.path : homePath);
      }
      return next;
    });
  }, [pathname, navigate, homePath]);

  const isHome = pathname === homePath;

  return (
    <div className="flex items-stretch h-full overflow-x-auto">
      <button
        onClick={() => navigate(homePath)}
        className={cn(
          "flex items-center gap-2 px-5 h-full text-sm whitespace-nowrap border-b-2 transition",
          isHome ? `${accentClass} font-semibold` : "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        <Home className="w-4 h-4" />
        {homeLabel}
      </button>
      {tabs.map(t => {
        const active = pathname === t.path;
        return (
          <div
            key={t.path}
            onClick={() => navigate(t.path)}
            className={cn(
              "group flex items-center gap-2 pl-4 pr-2 h-full text-sm whitespace-nowrap border-b-2 cursor-pointer transition",
              active ? `${accentClass} font-semibold` : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <span>{t.label}</span>
            <button
              onClick={(e) => closeTab(e, t.path)}
              className="w-5 h-5 rounded-sm flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-muted"
              aria-label="关闭标签"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
