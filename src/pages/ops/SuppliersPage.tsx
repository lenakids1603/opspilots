import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ops/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, Archive, RotateCcw, Info, Loader2 } from "lucide-react";

type Supplier = {
  id: string;
  jst_supplier_id: string | null;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  status: string;
  confirm_status: "unconfirmed" | "confirmed" | "archived";
  confirmed_at: string | null;
  archived_at: string | null;
  archived_reason: string;
  remark: string | null;
  last_synced_at: string | null;
};

type AuditRow = {
  id: string; supplier_id: string; old_confirm_status: string; new_confirm_status: string;
  reason: string; operated_by: string | null; operated_at: string;
};

const TAB_LABEL: Record<string, string> = {
  unconfirmed: "未确认", confirmed: "已确认", archived: "已归档", all: "全部",
};

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [tab, setTab] = useState<string>("unconfirmed");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionRow, setActionRow] = useState<Supplier | null>(null);
  const [actionType, setActionType] = useState<"confirm" | "archive" | "restore" | "remark" | null>(null);
  const [reason, setReason] = useState("");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [s, a] = await Promise.all([
      supabase.from("ops_suppliers").select("*").order("updated_at", { ascending: false }),
      supabase.from("ops_supplier_confirm_audit_logs").select("*")
        .order("operated_at", { ascending: false }).limit(200),
    ]);
    setRows((s.data as any) ?? []);
    setAudits((a.data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { unconfirmed: 0, confirmed: 0, archived: 0, all: rows.length };
    rows.forEach(r => { (c as any)[r.confirm_status] = ((c as any)[r.confirm_status] ?? 0) + 1; });
    return c;
  }, [rows]);

  const jstStats = useMemo(() => {
    const jst = rows.filter(r => r.jst_supplier_id);
    const active = jst.filter(r => r.status === "active").length;
    const disabled = jst.filter(r => r.status === "disabled").length;
    return { total: jst.length, active, disabled };
  }, [rows]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows
      .filter(r => tab === "all" || r.confirm_status === tab)
      .filter(r => !kw || [r.name, r.code, r.jst_supplier_id, r.contact, r.phone]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(kw)));
  }, [rows, tab, keyword]);

  const openAction = (row: Supplier, type: "confirm" | "archive" | "restore" | "remark") => {
    setActionRow(row); setActionType(type); setReason("");
    setRemark(row.remark ?? "");
  };

  const submit = async () => {
    if (!actionRow || !actionType) return;
    setSubmitting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      const now = new Date().toISOString();
      const oldStatus = actionRow.confirm_status;
      let patch: any = {};
      let newStatus = oldStatus;

      if (actionType === "confirm") {
        newStatus = "confirmed";
        patch = { confirm_status: newStatus, confirmed_by: uid, confirmed_at: now, archived_reason: "", archived_at: null, archived_by: null };
      } else if (actionType === "archive") {
        if (!reason.trim()) { toast.error("请填写归档原因"); setSubmitting(false); return; }
        newStatus = "archived";
        patch = { confirm_status: newStatus, archived_reason: reason.trim(), archived_at: now, archived_by: uid };
      } else if (actionType === "restore") {
        newStatus = "unconfirmed";
        patch = { confirm_status: newStatus, confirmed_by: null, confirmed_at: null, archived_reason: "", archived_at: null, archived_by: null };
      } else if (actionType === "remark") {
        patch = { remark };
      }

      const { error } = await supabase.from("ops_suppliers").update(patch).eq("id", actionRow.id);
      if (error) throw error;

      if (actionType !== "remark") {
        await supabase.from("ops_supplier_confirm_audit_logs").insert({
          supplier_id: actionRow.id,
          old_confirm_status: oldStatus,
          new_confirm_status: newStatus,
          reason: reason.trim() || (actionType === "confirm" ? "人工确认为有效供应商" : actionType === "restore" ? "恢复为未确认" : ""),
          operated_by: uid,
        });
      }
      toast.success("操作成功");
      setActionRow(null); setActionType(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  const auditFor = (id: string) => audits.filter(a => a.supplier_id === id);

  return (
    <div>
      <PageHeader
        breadcrumb={["供应商系统", "供应商档案"]}
        title="供应商档案"
        description="区分聚水潭原始供应商与 ERP 人工确认的有效供应商"
      />

      <Alert className="mb-4">
        <Info className="h-4 w-4" />
        <AlertTitle>供应商范围说明</AlertTitle>
        <AlertDescription>
          聚水潭原始供应商 {jstStats.total} 个，其中 active {jstStats.active} 个、disabled {jstStats.disabled} 个。
          ERP 当前有效供应商以人工确认为准；供应商工作台、账号管理、账单核对仅使用「已确认」供应商。
        </AlertDescription>
      </Alert>

      <div className="flex items-center justify-between mb-3 gap-3">
        <Input
          placeholder="按名称 / 编码 / 聚水潭ID / 联系人搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="max-w-sm"
        />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {(["unconfirmed", "confirmed", "archived", "all"] as const).map(k => (
            <TabsTrigger key={k} value={k}>
              {TAB_LABEL[k]} <span className="ml-1.5 text-xs opacity-60">{(counts as any)[k]}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={tab} className="mt-3">
          <div className="border rounded-md bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>供应商名称</TableHead>
                  <TableHead>编码 / 聚水潭ID</TableHead>
                  <TableHead>联系人 / 电话</TableHead>
                  <TableHead>JST 状态</TableHead>
                  <TableHead>确认状态</TableHead>
                  <TableHead>最近同步 / 备注</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">暂无数据</TableCell></TableRow>
                )}
                {filtered.map(r => {
                  const log = auditFor(r.id)[0];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs">
                        <div>{r.code}</div>
                        {r.jst_supplier_id && <div className="text-muted-foreground">JST {r.jst_supplier_id}</div>}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{r.contact || "—"}</div>
                        <div className="text-muted-foreground">{r.phone || "—"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {r.confirm_status === "confirmed" && <Badge className="bg-emerald-600">已确认</Badge>}
                        {r.confirm_status === "unconfirmed" && <Badge variant="outline">未确认</Badge>}
                        {r.confirm_status === "archived" && <Badge variant="secondary">已归档</Badge>}
                        {r.confirm_status === "archived" && r.archived_reason && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">{r.archived_reason}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.last_synced_at ? new Date(r.last_synced_at).toLocaleString("zh-CN") : "—"}
                        {log && <div className="opacity-60 mt-0.5">最近变更：{log.old_confirm_status || "(空)"} → {log.new_confirm_status}</div>}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {r.confirm_status !== "confirmed" && (
                          <Button size="sm" variant="outline" onClick={() => openAction(r, "confirm")}>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />确认
                          </Button>
                        )}
                        {r.confirm_status !== "archived" && (
                          <Button size="sm" variant="outline" onClick={() => openAction(r, "archive")}>
                            <Archive className="w-3.5 h-3.5 mr-1" />归档
                          </Button>
                        )}
                        {r.confirm_status !== "unconfirmed" && (
                          <Button size="sm" variant="ghost" onClick={() => openAction(r, "restore")}>
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />恢复
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openAction(r, "remark")}>备注</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!actionRow} onOpenChange={(o) => { if (!o) { setActionRow(null); setActionType(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "confirm" && "确认为有效供应商"}
              {actionType === "archive" && "归档供应商"}
              {actionType === "restore" && "恢复为未确认"}
              {actionType === "remark" && "编辑备注"}
            </DialogTitle>
            <DialogDescription>
              {actionRow?.name}（{actionRow?.code}）
            </DialogDescription>
          </DialogHeader>
          {actionType === "archive" && (
            <div className="space-y-2">
              <Label>归档原因（必填）</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：聚水潭已停用 / 已停止合作 / 重复供应商" />
            </div>
          )}
          {actionType === "confirm" && (
            <div className="space-y-2">
              <Label>备注（可选）</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="确认说明" />
            </div>
          )}
          {actionType === "restore" && (
            <div className="space-y-2">
              <Label>恢复说明（可选）</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          {actionType === "remark" && (
            <div className="space-y-2">
              <Label>供应商备注</Label>
              <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionRow(null); setActionType(null); }}>取消</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
