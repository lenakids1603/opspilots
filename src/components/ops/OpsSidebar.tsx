import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Warehouse, Receipt, Building2, Package, Headphones,
  Database, Settings, ChevronDown, ChevronRight, LogOut, LayoutDashboard, TrendingUp, ShoppingCart,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Item = { title: string; url: string };
type Group = { title: string; icon: React.ComponentType<{ className?: string }>; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "运维系统", icon: TrendingUp,
    items: [
      { title: "运营分析", url: "/operations/analysis" },
      { title: "货期交付看板", url: "/purchase/delivery-dashboard" },
    ],
  },
  {
    title: "商品系统", icon: Package,
    items: [
      { title: "商品档案", url: "/products" },
      { title: "图片搜索入口", url: "/products/image-search" },
    ],
  },
  {
    title: "客服系统", icon: Headphones,
    items: [
      { title: "商品投诉登记", url: "/cs/complaints" },
    ],
  },
  {
    title: "财税系统", icon: Receipt,
    items: [
      { title: "财务总览", url: "/finance/overview" },
      { title: "公司资金流水", url: "/finance/cashflow" },
      { title: "财务基础资料", url: "/finance/master-data" },
      { title: "供应商账单核对", url: "/finance/supplier-bills" },
    ],
  },
  {
    title: "仓库系统", icon: Warehouse,
    items: [
      { title: "入库信息", url: "/warehouse/inbound-orders" },
      { title: "出库信息", url: "/warehouse/outbound" },
      { title: "销退信息", url: "/warehouse/sales-returns" },
    ],
  },
  {
    title: "采购系统", icon: ShoppingCart,
    items: [
      { title: "采购单管理", url: "/purchase/orders" },
    ],
  },
  {
    title: "供应商系统", icon: Building2,
    items: [
      { title: "供应商总览", url: "/suppliers/overview" },
      { title: "供应商档案", url: "/suppliers" },
      { title: "采购超时预警", url: "/suppliers/po-alerts" },
    ],
  },
  {
    title: "数据中心", icon: Database,
    items: [
      { title: "数据中心", url: "/data-center" },
      { title: "聚水潭同步", url: "/data-center/jst-integration" },
    ],
  },
  {
    title: "系统设置", icon: Settings,
    items: [
      { title: "用户管理", url: "/system/users" },
      { title: "供应商账号管理", url: "/system/supplier-accounts" },
      { title: "角色权限配置", url: "/system/roles" },
    ],
  },
];

export function OpsSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(GROUPS.map(g => [g.title, true]))
  );

  const toggle = (t: string) => setExpanded(s => ({ ...s, [t]: !s[t] }));
  const handleLogout = async () => { await signOut(); navigate("/login"); };

  return (
    <aside className="hidden md:flex w-60 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-screen sticky top-0">
      {/* Brand */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-ops-sky text-white font-bold flex items-center justify-center shadow-sm">
          <span className="font-serif text-base tracking-tight">LN</span>
        </div>
        <div className="leading-tight">
          <h1 className="text-[15px] font-bold text-white">Lenakids</h1>
          <span className="text-[11px] font-semibold text-sidebar-foreground/80 tracking-wide">OpsPilot ERP</span>
        </div>
      </div>

      {/* Menu */}
      <nav className="ops-sidebar-scroll flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <NavLink
          to="/"
          end
          className={({ isActive }) => cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition",
            isActive
              ? "bg-ops-sky/15 text-white border-l-2 border-ops-sky -ml-px"
              : "text-white/90 hover:bg-sidebar-accent hover:text-white"
          )}
        >
          <LayoutDashboard className="w-4 h-4" />
          工作台首页
        </NavLink>
        {GROUPS.map(group => {
          const Icon = group.icon;
          const open = expanded[group.title];
          return (
            <div key={group.title}>
              <button
                onClick={() => toggle(group.title)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] font-medium text-white/90 hover:bg-sidebar-accent transition"
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  {group.title}
                </span>
                {open ? <ChevronDown className="w-3.5 h-3.5 opacity-70" /> : <ChevronRight className="w-3.5 h-3.5 opacity-70" />}
              </button>
              {open && (
                <div className="pl-8 mt-0.5 mb-1 space-y-0.5">
                  {group.items.map(item => {
                    const active = pathname === item.url;
                    return (
                      <NavLink
                        key={item.url}
                        to={item.url}
                        end
                        className={cn(
                          "block px-3 py-1.5 rounded-md text-[12.5px] transition",
                          active
                            ? "bg-ops-sky/15 text-white font-semibold border-l-2 border-ops-sky -ml-px"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
                        )}
                      >
                        {item.title}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-sidebar-border space-y-2">
        <div className="text-[11px] text-sidebar-foreground/80 leading-tight">
          <div className="text-white font-medium">service@lenakids.com</div>
          <div className="text-[10px] text-sidebar-foreground/60 mt-0.5">协作版 1.0 · #LN9812</div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 transition"
        >
          <LogOut className="w-3 h-3" />
          注销退出账户
        </button>
      </div>
    </aside>
  );
}
