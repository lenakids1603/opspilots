import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Store, Link2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Mapping = {
  id: string;
  jst_shop_id: string;
  jst_shop_name: string;
  platform_type: string;
  platform_shop_id: string;
  shop_status: string;
  auth_status: string;
  matched_shop_id: string | null;
  matched_business_entity_id: string | null;
  matched_platform_id: string | null;
  mapping_status: string;
  last_sync_at: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  mapped:   { label: "已绑定", cls: "bg-emerald-100 text-emerald-700" },
  unmapped: { label: "未绑定", cls: "bg-amber-100 text-amber-700" },
  ignored:  { label: "已忽略", cls: "bg-muted text-muted-foreground" },
};

export function ShopMappingsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const mappingsQ = useQuery({
    queryKey: ["jst_shop_mappings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("jst_shop_mappings")
        .select("*")
        .order("mapping_status", { ascending: true })
        .order("jst_shop_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Mapping[];
    },
  });

  const shopsQ = useQuery({
    queryKey: ["shops_for_mapping"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shops")
        .select("id, name, external_shop_id, entity_id, platform_id")
        .is("deleted_at", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const entitiesQ = useQuery({
    queryKey: ["business_entities_for_mapping"],
    queryFn: async () => {
      const { data, error } = await supabase.from("business_entities")
        .select("id, name").is("deleted_at", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const platformsQ = useQuery({
    queryKey: ["platforms_for_mapping"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platforms")
        .select("id, name, code").is("deleted_at", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const update = useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Mapping> }) => {
      const { error } = await (supabase as any).from("jst_shop_mappings")
        .update(input.patch).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jst_shop_mappings"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_metrics"] });
      toast({ title: "已保存" });
    },
    onError: (e: any) => toast({ title: "保存失败", description: e.message, variant: "destructive" }),
  });

  const rows = mappingsQ.data ?? [];
  const total = rows.length;
  const mapped = rows.filter((r) => r.mapping_status === "mapped").length;
  const unmapped = rows.filter((r) => r.mapping_status === "unmapped").length;
  const ignored = rows.filter((r) => r.mapping_status === "ignored").length;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Store className="w-4 h-4 text-muted-foreground" /> 聚水潭店铺映射
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Link2 className="w-4 h-4 mr-1.5" /> 管理映射
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle>聚水潭店铺映射</DialogTitle>
                <DialogDescription>
                  未绑定店铺无法用于销售、退款、订单归属。请将聚水潭店铺绑定到系统 shop / 平台 / 个体户，或标记为已忽略。
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>聚水潭店铺</TableHead>
                      <TableHead>平台 / 平台店铺ID</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>系统 Shop</TableHead>
                      <TableHead>主体</TableHead>
                      <TableHead>平台</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const meta = STATUS_META[r.mapping_status] ?? STATUS_META.unmapped;
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="font-medium">{r.jst_shop_name || "—"}</div>
                            <div className="text-xs text-muted-foreground">JST ID: {r.jst_shop_id}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div>{r.platform_type || "—"}</div>
                            <div>{r.platform_shop_id || "—"}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={meta.cls}>{meta.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={r.matched_shop_id ?? ""}
                              onValueChange={(v) =>
                                update.mutate({
                                  id: r.id,
                                  patch: { matched_shop_id: v || null, mapping_status: v ? "mapped" : "unmapped" } as any,
                                })
                              }
                            >
                              <SelectTrigger className="w-[160px]"><SelectValue placeholder="未绑定" /></SelectTrigger>
                              <SelectContent>
                                {(shopsQ.data ?? []).map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={r.matched_business_entity_id ?? ""}
                              onValueChange={(v) =>
                                update.mutate({ id: r.id, patch: { matched_business_entity_id: v || null } as any })
                              }
                            >
                              <SelectTrigger className="w-[140px]"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>
                                {(entitiesQ.data ?? []).map((e) => (
                                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={r.matched_platform_id ?? ""}
                              onValueChange={(v) =>
                                update.mutate({ id: r.id, patch: { matched_platform_id: v || null } as any })
                              }
                            >
                              <SelectTrigger className="w-[120px]"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>
                                {(platformsQ.data ?? []).map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            {r.mapping_status === "ignored" ? (
                              <Button size="sm" variant="ghost"
                                onClick={() => update.mutate({ id: r.id, patch: { mapping_status: r.matched_shop_id ? "mapped" : "unmapped" } as any })}>
                                取消忽略
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost"
                                onClick={() => update.mutate({ id: r.id, patch: { mapping_status: "ignored" } as any })}>
                                忽略
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {rows.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无映射数据，请先触发店铺同步</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>关闭</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <Stat label="聚水潭店铺总数" value={total} />
          <Stat label="已绑定" value={mapped} tone="ok" />
          <Stat label="未绑定" value={unmapped} tone={unmapped ? "warn" : undefined} />
          <Stat label="已忽略" value={ignored} />
        </div>
        {unmapped > 0 && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            有 {unmapped} 个聚水潭店铺尚未绑定到系统 shop，销售、退款、订单归属暂时无法落到这些店铺。请点击「管理映射」完成绑定。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const cls = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
