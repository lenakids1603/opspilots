import { useEffect, useState } from "react";
import { HelpCircle, Clock } from "lucide-react";
import { SupplierSidebar } from "./SupplierSidebar";
import { TabsBar, TabLabels } from "@/components/layout/TabsBar";

const SUPPLIER_TAB_LABELS: TabLabels = {
  "/supplier/purchase-orders": "采购单",
  "/supplier/quotes": "款式报价",
  "/supplier/bills": "对账结算",
  "/supplier/ranking": "考核排名",
  "/supplier/complaints": "客户投诉",
};

function useNowBeijing() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const dateFmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
  const timeFmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return { date: dateFmt.format(now), time: timeFmt.format(now) };
}

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  const { date, time } = useNowBeijing();
  return (
    <div className="min-h-screen flex w-full bg-[hsl(150_20%_97%)]">
      <SupplierSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-border flex items-stretch justify-between pr-6 sticky top-0 z-10">
          <div className="flex-1 min-w-0">
            <TabsBar
              labels={SUPPLIER_TAB_LABELS}
              homePath="/supplier"
              homeLabel="工作台"
              storageKey="supplier:tabs"
              accentClass="border-emerald-600 text-emerald-800"
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

        <footer className="h-8 bg-[#0b1f1a] text-[11px] text-white/80 flex items-center justify-between px-6 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>EXTERNAL COOPERATIVE SECURITY SHIELD INTENSITY HIGH</span>
            <span className="text-white/30 mx-2">·</span>
            <span>EXTERNAL PORT: LENAKIDS SUPPLY CHAIN PORTAL</span>
          </div>
          <div className="text-white/60">v.2.5.0</div>
        </footer>
      </div>
    </div>
  );
}
