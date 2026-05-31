import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ops/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, RotateCw, Copy, Users, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type AccountStatus = "active" | "disabled";

interface SupplierAccount {
  id: string;
  username: string;
  email: string | null;
  supplier_id: string | null;
  supplier_name: string;
  contact_name: string;
  contact_phone: string;
  remark: string;
  status: AccountStatus;
  last_login_at: string | null;
}

interface SupplierOption { id: string; name: string }

const STATUS_META: Record<AccountStatus, { label: string; className: string }> = {
  active: { label: "正常", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  disabled: { label: "停用", className: "bg-muted text-muted-foreground border-border" },
};

const emptyForm = {
  username: "",
  supplier_id: "",
  contact_name: "",
  contact_phone: "",
  remark: "",
  password: "",
};

const SYMBOLS = "!@#$%*?";
const WEAK_PASSWORDS = new Set([
  "123456","12345678","password","password123","qwerty123",
  "admin123","gys123","jz123456","88888888","11111111",
]);

function genTempPassword() {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits + SYMBOLS;
  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(SYMBOLS)];
  for (let i = chars.length; i < 14; i++) chars.push(pick(all));
  return chars.sort(() => Math.random() - 0.5).join("");
}

function validateStrongPassword(password: string) {
  if (!password || password.length < 8) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  if (WEAK_PASSWORDS.has(password)) return "密码强度太低，请换一个更复杂的密码";
  if (!/[A-Z]/.test(password)) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  if (!/[a-z]/.test(password)) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  if (!/[0-9]/.test(password)) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  if (!/[!@#$%^&*?_\-+=().,;:]/.test(password)) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  return null;
}

// 统一调用 admin-supplier-accounts edge function：
// - 每次都先取最新 session，确保 access_token 不过期
// - 显式传入 Authorization header
// - 401 时统一跳转 /login
async function invokeAdminSupplierAccounts(
  options: { method?: "GET" | "POST"; body?: any } = {},
): Promise<{ data: any | null; error: string | null }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) {
    toast.error("登录已失效，请重新登录");
    await supabase.auth.signOut();
    window.location.href = "/login";
    return { data: null, error: "no_session" };
  }
  const { data, error } = await supabase.functions.invoke("admin-supplier-accounts", {
    method: options.method ?? "POST",
    body: options.body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    // 尝试从 FunctionsHttpError 中读取后端返回的具体错误体
    let bodyMsg = "";
    try {
      const ctx: any = (error as any).context;
      if (ctx?.json) {
        const j = await ctx.json();
        if (j?.error) bodyMsg = j.error;
      } else if (ctx?.text) {
        const t = await ctx.text();
        try { bodyMsg = JSON.parse(t)?.error || t; } catch { bodyMsg = t; }
      }
    } catch { /* ignore */ }
    const msg = bodyMsg || error.message || "";
    if (/401|Unauthorized/i.test(msg) && !bodyMsg) {
      toast.error("登录已失效，请重新登录");
      await supabase.auth.signOut();
      window.location.href = "/login";
      return { data: null, error: "unauthorized" };
    }
    return { data: null, error: msg || "操作失败" };
  }
  if (data?.error) return { data, error: data.error as string };
  return { data, error: null };
}

export default function SupplierAccountsPage() {
  const [rows, setRows] = useState<SupplierAccount[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierAccount | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [submitting, setSubmitting] = useState(false);

  const [resetTarget, setResetTarget] = useState<SupplierAccount | null>(null);
  const [setPwdTarget, setSetPwdTarget] = useState<SupplierAccount | null>(null);
  const [setPwdValue, setSetPwdValue] = useState("");
  const [resetResult, setResetResult] = useState<{ account: string; password: string } | null>(null);

  const loadRows = async () => {
    setLoading(true);
    const { data, error } = await invokeAdminSupplierAccounts({ method: "GET" });
    setLoading(false);
    if (error) {
      if (error !== "no_session" && error !== "unauthorized") {
        toast.error("加载失败：" + error);
      }
      return;
    }
    setRows(data?.rows ?? []);
  };

  const loadSuppliers = async () => {
    const { data } = await supabase.from("ops_suppliers").select("id, name").order("name");
    setSuppliers((data as any) ?? []);
  };

  useEffect(() => { loadRows(); loadSuppliers(); }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!kw) return true;
      return (
        (r.supplier_name ?? "").toLowerCase().includes(kw) ||
        (r.username ?? "").toLowerCase().includes(kw) ||
        (r.contact_name ?? "").toLowerCase().includes(kw)
      );
    });
  }, [rows, keyword, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, password: genTempPassword() });
    setFormOpen(true);
  };

  const openEdit = (row: SupplierAccount) => {
    setEditing(row);
    setForm({
      username: row.username,
      supplier_id: row.supplier_id ?? "",
      contact_name: row.contact_name,
      contact_phone: row.contact_phone,
      remark: row.remark,
      password: "",
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!form.username.trim()) return toast.error("请填写登录账号");
    if (!form.supplier_id) return toast.error("请选择供应商");
    if (!editing) {
      const pwdError = validateStrongPassword(form.password);
      if (pwdError) return toast.error(pwdError);
    }
    setSubmitting(true);
    const action = editing ? "update" : "create";
    const payload: any = editing
      ? {
          action, id: editing.id,
          supplier_id: form.supplier_id,
          contact_name: form.contact_name,
          contact_phone: form.contact_phone,
          remark: form.remark,
        }
      : {
          action,
          username: form.username.trim().toLowerCase(),
          password: form.password,
          supplier_id: form.supplier_id,
          contact_name: form.contact_name,
          contact_phone: form.contact_phone,
          remark: form.remark,
        };
    const { data, error } = await invokeAdminSupplierAccounts({ body: payload });
    setSubmitting(false);
    if (error) {
      if (error !== "no_session" && error !== "unauthorized") toast.error(error);
      return;
    }
    toast.success(editing ? "供应商账号已更新" : "供应商账号已创建");
    setFormOpen(false);
    if (!editing) {
      setResetResult({ account: form.username.trim().toLowerCase(), password: form.password });
    }
    loadRows();
  };

  const toggleStatus = async (row: SupplierAccount) => {
    const disabled = row.status === "active";
    const { error } = await invokeAdminSupplierAccounts({
      body: { action: "set_status", id: row.id, disabled },
    });
    if (error) {
      if (error !== "no_session" && error !== "unauthorized") toast.error(error);
      return;
    }
    toast.success(disabled ? "账号已停用" : "账号已启用");
    loadRows();
  };

  const confirmReset = async () => {
    if (!resetTarget) return;
    const pwd = genTempPassword();
    const { error } = await invokeAdminSupplierAccounts({
      body: { action: "set_password", id: resetTarget.id, password: pwd },
    });
    if (error) {
      if (error !== "no_session" && error !== "unauthorized") toast.error("重置失败：" + error);
      return;
    }
    setResetResult({ account: resetTarget.username, password: pwd });
    setResetTarget(null);
    toast.success("临时密码已生成");
  };

  const submitSetPwd = async () => {
    if (!setPwdTarget) return;
    const pwdError = validateStrongPassword(setPwdValue);
    if (pwdError) return toast.error(pwdError);
    const { error } = await invokeAdminSupplierAccounts({
      body: { action: "set_password", id: setPwdTarget.id, password: setPwdValue },
    });
    if (error) {
      if (error !== "no_session" && error !== "unauthorized") toast.error("修改失败：" + error);
      return;
    }
    toast.success("密码已更新");
    setSetPwdTarget(null);
    setSetPwdValue("");
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["系统设置", "供应商账号管理"]}
        title="供应商账号管理"
        description="开通、停用、修改或重置供应商门户登录密码"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" /> 新建供应商账号
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <Input
            placeholder="搜索供应商名称、账号、联系人"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            className="w-72"
          />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">正常</SelectItem>
              <SelectItem value="disabled">停用</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => { setKeyword(""); setStatusFilter("all"); }}>
            重置
          </Button>
          <Button variant="outline" size="sm" onClick={loadRows}>
            <RotateCw className="w-4 h-4 mr-1" /> 刷新
          </Button>
          <div className="ml-auto text-xs text-muted-foreground">
            共 {filtered.length} 个账号
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> 加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Users className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="text-sm font-medium">暂无供应商账号</div>
              <div className="text-xs text-muted-foreground mt-1">点击右上角新建供应商账号开始</div>
              <Button size="sm" className="mt-4" onClick={openCreate}>
                <Plus className="w-4 h-4 mr-1" /> 新建供应商账号
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>供应商</TableHead>
                  <TableHead>联系人</TableHead>
                  <TableHead>联系方式</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最后登录</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
                  const meta = STATUS_META[row.status];
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.username}</TableCell>
                      <TableCell>{row.supplier_name || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{row.contact_name || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{row.contact_phone || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.last_login_at
                          ? new Date(row.last_login_at).toLocaleString("zh-CN")
                          : <span className="text-muted-foreground">从未登录</span>}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>编辑</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setSetPwdTarget(row); setSetPwdValue(""); }}>
                          <KeyRound className="w-3.5 h-3.5 mr-1" /> 修改密码
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setResetTarget(row)}>
                          重置密码
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleStatus(row)}>
                          {row.status === "active" ? "停用" : "启用"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 新建 / 编辑 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑供应商账号" : "新建供应商账号"}</DialogTitle>
            <DialogDescription>
              供应商账号用于登录供应商门户，仅可访问其自身相关数据
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>登录账号 <span className="text-destructive">*</span></Label>
              <Input
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="例如：jz"
                disabled={!!editing}
              />
              {!editing && (
                <div className="text-xs text-muted-foreground">登录邮箱将自动生成为 <span className="font-mono">{(form.username || "<账号>").toLowerCase()}@supplier.local</span>，供应商也可直接用账号登录</div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>关联供应商 <span className="text-destructive">*</span></Label>
              <Select value={form.supplier_id} onValueChange={(v) => setForm({ ...form, supplier_id: v })}>
                <SelectTrigger><SelectValue placeholder="选择供应商" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label>初始密码 <span className="text-destructive">*</span></Label>
                <div className="flex gap-2">
                  <Input
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="至少 8 位，含大小写字母+数字+特殊符号"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, password: genTempPassword() })}>
                    随机生成
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  密码至少 8 位，需包含大小写字母、数字和特殊符号。请不要使用 123456、888888、gys123 等简单密码。
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>联系人</Label>
                <Input
                  value={form.contact_name}
                  onChange={e => setForm({ ...form, contact_name: e.target.value })}
                  placeholder="联系人姓名"
                />
              </div>
              <div className="space-y-1.5">
                <Label>联系方式</Label>
                <Input
                  value={form.contact_phone}
                  onChange={e => setForm({ ...form, contact_phone: e.target.value })}
                  placeholder="手机号 / 微信"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>备注</Label>
              <Textarea
                rows={2}
                value={form.remark}
                onChange={e => setForm({ ...form, remark: e.target.value })}
                placeholder="选填"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={submitForm} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {editing ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 修改密码（手动指定） */}
      <Dialog open={!!setPwdTarget} onOpenChange={(o) => { if (!o) { setSetPwdTarget(null); setSetPwdValue(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>修改登录密码</DialogTitle>
            <DialogDescription>
              账号 <span className="font-mono">{setPwdTarget?.username}</span>，请输入新密码
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>新密码</Label>
            <div className="flex gap-2">
              <Input value={setPwdValue} onChange={e => setSetPwdValue(e.target.value)} placeholder="至少 8 位，含大小写字母+数字+特殊符号" />
              <Button type="button" variant="outline" size="sm" onClick={() => setSetPwdValue(genTempPassword())}>
                随机
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              密码至少 8 位，需包含大小写字母、数字和特殊符号。请不要使用 123456、888888、gys123 等简单密码。
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSetPwdTarget(null); setSetPwdValue(""); }}>取消</Button>
            <Button onClick={submitSetPwd}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码确认 */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置临时密码</AlertDialogTitle>
            <AlertDialogDescription>
              确定要为账号 <span className="font-mono">{resetTarget?.username}</span> 生成新的随机临时密码吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset}>
              <RotateCw className="w-4 h-4 mr-1" /> 确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 密码结果 */}
      <Dialog open={!!resetResult} onOpenChange={(o) => !o && setResetResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>临时密码已生成</DialogTitle>
            <DialogDescription>请将临时密码发给供应商，供应商首次登录后请尽快修改</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">账号</Label>
              <div className="font-mono text-sm px-3 py-2 bg-muted rounded-md">{resetResult?.account}</div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">临时密码</Label>
              <div className="flex items-center gap-2">
                <div className="font-mono text-base px-3 py-2 bg-muted rounded-md flex-1 tracking-wider">
                  {resetResult?.password}
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={() => {
                    if (resetResult) {
                      navigator.clipboard.writeText(resetResult.password);
                      toast.success("已复制到剪贴板");
                    }
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" /> 复制
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setResetResult(null)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
