import { Card } from "@/components/ui/card";
import { Inbox } from "lucide-react";

export function EmptyTable({ columns, hint }: { columns: string[]; hint?: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="bg-muted/50 border-b border-border px-4 py-3 grid gap-4" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
        {columns.map(c => (
          <div key={c} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{c}</div>
        ))}
      </div>
      <div className="py-16 flex flex-col items-center justify-center text-muted-foreground">
        <Inbox className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm">暂无数据</p>
        {hint && <p className="text-xs mt-1 opacity-70">{hint}</p>}
      </div>
    </Card>
  );
}
