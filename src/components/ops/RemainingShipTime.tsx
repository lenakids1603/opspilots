import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  planDeliveryDate?: string | null;
  shipped?: boolean; // 已发货则不显示倒计时
}

function format(ms: number): { text: string; overdue: boolean; urgent: boolean } {
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  let text = "";
  if (d > 0) text = `${d}天${h}时${m}分`;
  else if (h > 0) text = `${h}时${m}分${s}秒`;
  else text = `${m}分${s}秒`;
  return { text, overdue, urgent: !overdue && ms < 24 * 3600 * 1000 };
}

export function RemainingShipTime({ planDeliveryDate, shipped }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!planDeliveryDate) return <span className="text-muted-foreground">-</span>;
  if (shipped) return <span className="text-muted-foreground text-xs">已发货</span>;
  const target = new Date(planDeliveryDate).getTime();
  if (isNaN(target)) return <span className="text-muted-foreground">-</span>;
  const { text, overdue, urgent } = format(target - now);
  return (
    <span
      className={cn(
        "tabular-nums text-xs whitespace-nowrap",
        overdue ? "text-rose-600 font-semibold" : urgent ? "text-amber-600 font-medium" : "text-emerald-600"
      )}
    >
      {overdue ? `超时 ${text}` : `剩 ${text}`}
    </span>
  );
}
