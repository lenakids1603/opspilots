import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutGrid, ClipboardList, Tag, Wallet, Trophy, MessageSquareWarning, LogOut,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const NAV = [
  { to: "/supplier", label: "工作台", icon: LayoutGrid, end: true },
  { to: "/supplier/purchase-orders", label: "采购单", icon: ClipboardList },
  { to: "/supplier/quotes", label: "款式报价", icon: Tag },
  { to: "/supplier/bills", label: "对账结算", icon: Wallet },
  { to: "/supplier/ranking", label: "考核排名", icon: Trophy },
  { to: "/supplier/complaints", label: "客户投诉", icon: MessageSquareWarning },
];

export function SupplierSidebar() {
  const nav = useNavigate();
  const { signOut } = useAuth();
  const handleLogout = async () => {
    await signOut();
    nav("/login", { replace: true });
  };
  return (
    <aside className="w-[220px] shrink-0 bg-[#0f2e26] text-white/85 flex flex-col">
      {/* Brand */}
      <div className="px-5 py-4 flex items-center gap-3 border-b border-white/5">
        <div className="w-10 h-10 rounded-lg bg-white text-[#0f2e26] font-bold flex items-center justify-center">
          LN
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-white text-sm">Lenakids</div>
          <div className="text-[10px] text-emerald-300/80">供应商协同门户</div>
        </div>
      </div>

      {/* Section title */}
      <div className="px-5 pt-4 pb-2 text-[10px] tracking-widest text-white/40">
        供应商主功能导航
      </div>

      <nav className="flex-1 px-2 space-y-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end as any}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] transition-colors ${
                isActive
                  ? "bg-white text-[#0f2e26] font-semibold shadow"
                  : "text-white/75 hover:bg-white/5 hover:text-white"
              }`
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Service footer removed per request */}

      <button
        onClick={handleLogout}
        className="m-3 mt-1 flex items-center justify-center gap-2 h-9 rounded-md bg-white/5 hover:bg-white/10 text-[12px] text-white/80 border border-white/10"
      >
        <LogOut className="w-3.5 h-3.5" />
        注销退出门户
      </button>
    </aside>
  );
}
