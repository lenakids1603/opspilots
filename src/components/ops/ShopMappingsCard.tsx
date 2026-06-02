import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Store, Link2, AlertTriangle, History, RefreshCw, ExternalLink, EyeOff } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  mapping_note: string;
  bind_reason: string;
  ignore_reason: string;
  ignored_at: string | null;
  last_sync_at: string | null;
};

type AuditLog = {
  id: string;
  mapping_id: string;
  jst_shop_id: string;
  action_type: string;
  reason: string;
  old_status: string | null;
  new_status: string | null;
  operated_by: string | null;
  operated_at: string;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  mapped:   { label: "已映射", cls: "bg-emerald-100 text-emerald-700" },
  unmapped: { label: "待处理", cls: "bg-amber-100 text-amber-700" },
  pending:  { label: "待处理", cls: "bg-amber-100 text-amber-700" },
  ignored:  { label: "已忽略", cls: "bg-muted text-muted-foreground" },
};

const IGNORE_PRESETS = ["历史废弃店铺", "店铺已关闭", "个体户已注销", "测试店铺", "不参与当前统计", "其他"];

export function ShopMappingsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<Mapping | null>(null);
  const [ignoreTarget, setIgnoreTarget] = useState<Mapping | null>(null);
  const [auditTarget, setAuditTarget] = useState<Mapping | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchIgnoreOpen, setBatchIgnoreOpen] = useState(false);

  const mappingsQ = useQuery({
    queryKey: ["jst_shop_mappings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("jst_shop_mappings")
        .select("*").order("mapping_status").order("jst_shop_name");
      if (error) throw error;
      return (data ?? []) as Mapping[];
    },
  });

  const shopsQ = useQuery({
    queryKey: ["shops_for_mapping"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shops")
        .select("id, name, external_shop_id, status, is_ignored, entity_id, platform_id").is("deleted_at", null).order("name");
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

  const updateMut = useMutation({
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

  const resyncMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("jst_resync_shop_mappings_from_shops");
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["jst_shop_mappings"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_metrics"] });
      toast({
        title: "自动匹配完成",
        description: `更新 ${res?.updated_count ?? 0} 条;已映射 ${res?.mapped_after ?? 0}/未映射 ${res?.unmapped_after ?? 0}/已忽略 ${res?.ignored_after ?? 0}`,
      });
    },
    onError: (e: any) => toast({ title: "自动匹配失败", description: e.message, variant: "destructive" }),
  });



  const batchIgnoreMut = useMutation({
    mutationFn: async (input: { ids: string[]; reason: string }) => {
      const { error } = await (supabase as any).from("jst_shop_mappings")
        .update({ mapping_status: "ignored", ignore_reason: input.reason, ignored_at: new Date().toISOString() })
        .in("id", input.ids);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["jst_shop_mappings"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_metrics"] });
      setSelectedIds(new Set());
      setBatchIgnoreOpen(false);
      toast({ title: `已批量忽略 ${vars.ids.length} 个店铺` });
    },
    onError: (e: any) => toast({ title: "批量忽略失败", description: e.message, variant: "destructive" }),
  });

  const rows = mappingsQ.data ?? [];
  const shopById = useMemo(() => new Map((shopsQ.data ?? []).map((s: any) => [s.id, s])), [shopsQ.data]);

  // 双层语义:processing_status(mapped/ignored/pending) + reporting_status(ready/incomplete/ignored)
  // ready = mapped + 主体 + 平台 + 关联 shop 启用且参与统计 (is_ignored=false 且 status='active')
  const quality = useMemo(() => {
    const total = rows.length;
    const mappedRows = rows.filter(r => r.mapping_status === "mapped");
    const mapped = mappedRows.length;
    const ignored = rows.filter(r => r.mapping_status === "ignored").length;
    const pending = total - mapped - ignored;

    // 仅"已映射且关联 shop 启用且参与统计"的店铺需要完整资料
    const participating = mappedRows.filter(r => {
      const s: any = r.matched_shop_id ? shopById.get(r.matched_shop_id) : null;
      return s && s.is_ignored === false && (s.status ?? "active") === "active";
    });
    const noEntity = participating.filter(r => !r.matched_business_entity_id).length;
    const noPlatform = participating.filter(r => !r.matched_platform_id).length;
    const ready = participating.filter(r => r.matched_business_entity_id && r.matched_platform_id).length;

    const shopCount = new Map<string, number>();
    mappedRows.forEach(r => {
      if (r.matched_shop_id) shopCount.set(r.matched_shop_id, (shopCount.get(r.matched_shop_id) ?? 0) + 1);
    });
    const dupShopIds = new Set(Array.from(shopCount.entries()).filter(([, n]) => n > 1).map(([id]) => id));
    const dupCount = mappedRows.filter(r => r.matched_shop_id && dupShopIds.has(r.matched_shop_id)).length;

    const processedRate = total > 0 ? Math.round(((mapped + ignored) / total) * 100) : 0;
    const allowSummary = pending === 0 && noEntity === 0 && noPlatform === 0 && dupCount === 0;
    const needsAttention = !allowSummary;
    const unmapped = pending;
    const completeness = processedRate;
    return { total, mapped, ready, unmapped, pending, ignored, noEntity, noPlatform, dupCount, completeness, processedRate, needsAttention, allowSummary, dupShopIds };
  }, [rows, shopById]);

  const selectableRows = rows.filter(r => r.mapping_status !== "ignored");
  const allSelected = selectableRows.length > 0 && selectableRows.every(r => selectedIds.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(selectableRows.map(r => r.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Store className="w-4 h-4 text-muted-foreground" /> 聚水潭店铺映射
            {quality.needsAttention && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-700">需处理</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={resyncMut.isPending}
              onClick={() => resyncMut.mutate()}
              title="根据财务店铺主表中的聚水潭店铺 ID,自动回填映射、主体、平台"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${resyncMut.isPending ? "animate-spin" : ""}`} />
              根据财务店铺自动匹配
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline"><Link2 className="w-4 h-4 mr-1.5" /> 管理映射</Button>
              </DialogTrigger>
            <DialogContent className="max-w-6xl">
              <DialogHeader>
                <DialogTitle>聚水潭店铺映射</DialogTitle>
                <DialogDescription>
                  未绑定店铺无法用于销售、退款、订单归属。请绑定到系统 shop / 主体 / 平台,或填写原因后忽略。
                </DialogDescription>
              </DialogHeader>
              {selectedIds.size > 0 && (
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-2">
                  <span className="text-xs text-amber-800">已选 {selectedIds.size} 个店铺</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>清空选择</Button>
                    <Button size="sm" variant="destructive" onClick={() => setBatchIgnoreOpen(true)}>
                      <EyeOff className="w-3.5 h-3.5 mr-1" />批量忽略
                    </Button>
                  </div>
                </div>
              )}
              <div className="max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                      </TableHead>
                      <TableHead>聚水潭店铺</TableHead>
                      <TableHead>平台 / 平台店铺ID</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>系统 Shop</TableHead>
                      <TableHead>主体 / 平台</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const meta = STATUS_META[r.mapping_status] ?? STATUS_META.unmapped;
                      const matchedShop = shopsQ.data?.find(s => s.id === r.matched_shop_id);
                      const matchedEntity = entitiesQ.data?.find(e => e.id === r.matched_business_entity_id);
                      const matchedPlatform = platformsQ.data?.find(p => p.id === r.matched_platform_id);
                      const isDup = r.matched_shop_id && quality.dupShopIds.has(r.matched_shop_id);
                      const canSelect = r.mapping_status !== "ignored";
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            {canSelect && (
                              <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleOne(r.id)} />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{r.jst_shop_name || "—"}</div>
                            <div className="text-xs text-muted-foreground">JST ID: {r.jst_shop_id}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div>{r.platform_type || "—"}</div>
                            <div>{r.platform_shop_id || "—"}</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant="secondary" className={meta.cls}>{meta.label}</Badge>
                              {isDup && <Badge variant="secondary" className="bg-red-100 text-red-700 text-xs">重复绑定</Badge>}
                              {r.mapping_status === "ignored" && r.ignore_reason && (
                                <span className="text-xs text-muted-foreground">原因:{r.ignore_reason}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{matchedShop?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-xs">
                            <div>主体:{matchedEntity?.name ?? <span className="text-muted-foreground">—</span>}</div>
                            <div>平台:{matchedPlatform?.name ?? <span className="text-muted-foreground">—</span>}</div>
                          </TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="sm" variant="ghost" onClick={() => setBindTarget(r)}>绑定</Button>
                            {r.mapping_status === "ignored" ? (
                              <Button size="sm" variant="ghost"
                                onClick={() => updateMut.mutate({ id: r.id, patch: { mapping_status: r.matched_shop_id ? "mapped" : "unmapped", ignore_reason: "", ignored_by: null, ignored_at: null } as any })}>
                                恢复
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => setIgnoreTarget(r)}>忽略</Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setAuditTarget(r)}>
                              <History className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {rows.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无映射数据,请先触发店铺同步</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>关闭</Button></DialogFooter>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* 基础统计 */}
        <div className="grid grid-cols-4 gap-4 text-sm">
          <Stat label="聚水潭店铺总数" value={quality.total} />
          <Stat label="已完整可统计" value={quality.ready} tone="ok" />
          <Stat label="已忽略" value={quality.ignored} />
          <Stat label="待处理" value={quality.pending} tone={quality.pending ? "warn" : undefined} />
        </div>

        {/* 质量检查 */}
        <div className="grid grid-cols-4 gap-4 text-sm pt-2 border-t">
          <Stat label="映射处理率" value={`${quality.processedRate}%`} tone={quality.processedRate === 100 ? "ok" : "warn"} />
          <Stat
            label="缺主体（已映射启用）"
            value={quality.noEntity}
            tone={quality.noEntity ? "warn" : undefined}
            onClick={() => navigate("/finance/master-data?tab=shops&filter=missing_entity")}
          />
          <Stat
            label="缺平台（已映射启用）"
            value={quality.noPlatform}
            tone={quality.noPlatform ? "warn" : undefined}
            onClick={() => navigate("/finance/master-data?tab=shops&filter=missing_platform")}
          />
          <Stat label="疑似重复绑定" value={quality.dupCount} tone={quality.dupCount ? "danger" : undefined} />
        </div>

        {quality.needsAttention ? (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              {quality.pending === 0 && (quality.noEntity > 0 || quality.noPlatform > 0)
                ? `店铺已全部处理，但仍有 ${quality.noEntity} 个已映射店铺缺经营主体、${quality.noPlatform} 个缺平台，因此正式销售汇总暂不可用。`
                : `仍有店铺未处理时，正式销售汇总受限。已忽略的历史店铺不会阻塞同步。`}
              <Button
                size="sm" variant="link" className="h-auto p-0 ml-2 text-amber-900"
                onClick={() => navigate("/finance/master-data?tab=shops&filter=missing_entity")}
              >
                去财务基础资料处理 <ExternalLink className="w-3 h-3 ml-0.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            店铺映射处理完成。已忽略店铺不参与正式经营统计。
          </div>
        )}
      </CardContent>

      {/* 批量忽略弹窗 */}
      <IgnoreDialog
        target={batchIgnoreOpen ? ({ jst_shop_name: `${selectedIds.size} 个店铺`, jst_shop_id: "(批量)" } as any) : null}
        onClose={() => setBatchIgnoreOpen(false)}
        onSave={(reason) => batchIgnoreMut.mutate({ ids: Array.from(selectedIds), reason })}
      />

      {/* 绑定弹窗 */}
      <BindDialog
        target={bindTarget}
        onClose={() => setBindTarget(null)}
        shops={shopsQ.data ?? []}
        entities={entitiesQ.data ?? []}
        platforms={platformsQ.data ?? []}
        onSave={(patch) => bindTarget && updateMut.mutate({ id: bindTarget.id, patch }, { onSuccess: () => setBindTarget(null) })}
      />

      {/* 忽略弹窗 */}
      <IgnoreDialog
        target={ignoreTarget}
        onClose={() => setIgnoreTarget(null)}
        onSave={(reason) => ignoreTarget && updateMut.mutate({
          id: ignoreTarget.id,
          patch: { mapping_status: "ignored", ignore_reason: reason, ignored_at: new Date().toISOString() } as any,
        }, { onSuccess: () => setIgnoreTarget(null) })}
      />

      {/* 审计日志弹窗 */}
      <AuditDialog target={auditTarget} onClose={() => setAuditTarget(null)} />
    </Card>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: number | string; tone?: "ok" | "warn" | "danger"; onClick?: () => void }) {
  const cls = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "danger" ? "text-red-600" : "";
  return (
    <div className={onClick ? "cursor-pointer hover:opacity-80" : ""} onClick={onClick} title={onClick ? "点击跳转到财务基础资料处理" : undefined}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function BindDialog({
  target, onClose, shops, entities, platforms, onSave,
}: {
  target: Mapping | null;
  onClose: () => void;
  shops: any[]; entities: any[]; platforms: any[];
  onSave: (patch: any) => void;
}) {
  const [shopId, setShopId] = useState<string>("");
  const [entityId, setEntityId] = useState<string>("");
  const [platformId, setPlatformId] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  // 初始化
  useMemo(() => {
    if (target) {
      setShopId(target.matched_shop_id ?? "");
      setEntityId(target.matched_business_entity_id ?? "");
      setPlatformId(target.matched_platform_id ?? "");
      setReason(target.bind_reason ?? "");
    }
  }, [target?.id]);

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定聚水潭店铺</DialogTitle>
          <DialogDescription>{target?.jst_shop_name} (JST {target?.jst_shop_id})</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>系统店铺 *</Label>
            <Select value={shopId} onValueChange={setShopId}>
              <SelectTrigger><SelectValue placeholder="选择系统 shop" /></SelectTrigger>
              <SelectContent>
                {shops.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>个体户主体</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue placeholder="选择主体" /></SelectTrigger>
              <SelectContent>
                {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>平台</Label>
            <Select value={platformId} onValueChange={setPlatformId}>
              <SelectTrigger><SelectValue placeholder="选择平台" /></SelectTrigger>
              <SelectContent>
                {platforms.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>绑定原因 / 备注</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="选填,例如:个体户A的天猫主店" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={!shopId}
            onClick={() => onSave({
              matched_shop_id: shopId || null,
              matched_business_entity_id: entityId || null,
              matched_platform_id: platformId || null,
              bind_reason: reason,
              mapping_note: reason,
              mapping_status: shopId ? "mapped" : "unmapped",
            })}
          >保存绑定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IgnoreDialog({
  target, onClose, onSave,
}: {
  target: Mapping | null;
  onClose: () => void;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useMemo(() => { if (target) setReason(target.ignore_reason || ""); }, [target?.id]);

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>忽略聚水潭店铺</DialogTitle>
          <DialogDescription>
            忽略后,该店铺不会进入销售汇总与个体户流水统计。{target?.jst_shop_name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {IGNORE_PRESETS.map(p => (
              <Button key={p} size="sm" variant={reason === p ? "default" : "outline"} onClick={() => setReason(p)}>{p}</Button>
            ))}
          </div>
          <div>
            <Label>忽略原因 * (必填)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请填写忽略原因" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!reason.trim()} onClick={() => onSave(reason.trim())}>确认忽略</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_LABEL: Record<string, string> = {
  bind: "绑定", unbind: "解绑", ignore: "忽略", restore: "恢复", update: "修改",
};

function AuditDialog({ target, onClose }: { target: Mapping | null; onClose: () => void }) {
  const logsQ = useQuery({
    queryKey: ["jst_shop_mapping_audit", target?.id],
    enabled: !!target,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("jst_shop_mapping_audit_logs")
        .select("*").eq("mapping_id", target!.id).order("operated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AuditLog[];
    },
  });

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>映射变更记录</DialogTitle>
          <DialogDescription>{target?.jst_shop_name} (JST {target?.jst_shop_id})</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>状态变更</TableHead>
                <TableHead>说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(logsQ.data ?? []).map(l => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{new Date(l.operated_at).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="secondary">{ACTION_LABEL[l.action_type] ?? l.action_type}</Badge></TableCell>
                  <TableCell className="text-xs">{l.old_status ?? "—"} → {l.new_status ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.reason || "—"}</TableCell>
                </TableRow>
              ))}
              {(logsQ.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">暂无变更记录</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
