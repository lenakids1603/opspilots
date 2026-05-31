import { useEffect, useState } from "react";
import { HelpCircle, Clock } from "lucide-react";
import { OpsSidebar } from "./OpsSidebar";
import { TabsBar, TabLabels } from "@/components/layout/TabsBar";

const OPS_TAB_LABELS: TabLabels = {
  "/operations/analysis": "运营分析",
  "/suppliers": "供应商档案",
  "/products": "商品档案",
  "/products/skus": "SKU 管理",
  "/products/detail": "商品详情",
  "/products/image-search": "图片搜索入口",
  "/warehouse/arrivals": "到货登记",
  "/finance/overview": "财务总览",
  "/finance/cashflow": "公司资金流水",
  "/finance/supplier-bills": "供应商账单核对",
  "/finance/books": "账务管理",
  "/finance/entities": "个体户账户管理",
  "/finance/quota-alerts": "额度预警",
  "/suppliers/overview": "供应商总览",
  "/suppliers/po-alerts": "采购超时预警",
  "/cs/complaints": "商品投诉登记",
  "/cs/refunds": "异常退款商品",
  "/cs/quality": "质量问题分析",
  "/data-center": "数据中心",
  "/system/users": "用户管理",
  "/system/supplier-accounts": "供应商账号管理",
  "/system/roles": "角色权限配置",
};

function useNowBeijing() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // format in Beijing tz
  const dateFmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
  const timeFmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return { date: dateFmt.format(now), time: timeFmt.format(now) };
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const { date, time } = useNowBeijing();

  return (
    <div className="min-h-screen flex w-full bg-[hsl(210_25%_97%)]">
      <OpsSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar: tab + clock */}
        <header className="h-14 bg-white border-b border-border flex items-stretch justify-between pr-6 sticky top-0 z-10">
          <div className="flex-1 min-w-0">
            <TabsBar
              labels={OPS_TAB_LABELS}
              homePath="/"
              homeLabel="系统首页"
              storageKey="ops:tabs"
              accentClass="border-ops-sky text-ops-navy"
            />
          </div>
          <div className="flex items-center gap-5 text-xs text-muted-foreground">
            <div className="text-right leading-tight">
              <div className="font-medium text-foreground">{date}</div>
              <div className="flex items-center justify-end gap-1 mt-0.5">
                <Clock className="w-3 h-3" />
                <span className="font-mono">{time} (Beijing Time)</span>
              </div>
            </div>
            <button className="w-7 h-7 rounded-full border border-border flex items-center justify-center hover:bg-muted">
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">{children}</main>

        {/* Bottom status bar */}
        <footer className="h-8 bg-[#0b1220] text-[11px] text-white/80 flex items-center justify-between px-6 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>API_MODE: LIVE CODEX API</span>
            <span className="text-white/30 mx-2">·</span>
            <span>OWNER: AI-STUDIO (FRONTEND) &amp; CODEX (BACKEND &amp; INFRA)</span>
          </div>
          <div className="text-white/60">v.2.5.0</div>
        </footer>
      </div>
    </div>
  );
}
