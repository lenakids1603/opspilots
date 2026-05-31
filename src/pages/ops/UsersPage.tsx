import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ops/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Plus, Search, RotateCcw, Users, UserCheck, UserX, ShieldAlert, ShieldCheck,
  KeyRound, Power, Copy, RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";

// ============== 静态选项 ==============
const DEPARTMENTS = [
  "运营组", "直播组", "开发组", "财务", "人事", "采购", "文员", "客服",
  "仓库入仓", "仓库发货", "售后销退", "其他",
];

const ROLES: { code: string; name: string }[] = [
  { code: "super_admin", name: "超级管理员" },
  { code: "boss_view",   name: "老板 / 经营查看" },
  { code: "finance",     name: "财务" },
  { code: "operation",   name: "运营" },
  { code: "purchase",    name: "商品 / 采购" },
  { code: "service",     name: "客服" },
  { code: "wh_in",       name: "仓库入库" },
  { code: "wh_out",      name: "仓库发货 / 售后" },
  { code: "hr",          name: "人事" },
  { code: "readonly",    name: "普通只读" },
];

const EMPLOYMENT_OPTIONS = [
  { value: "active",   label: "在职" },
  { value: "resigned", label: "离职" },
  { value: "paused",   label: "临时停用" },
];

const STATUS_OPTIONS = [
  { value: "active",   label: "正常" },
  { value: "disabled", label: "停用" },
  { value: "pending",  label: "待激活" },
];

// ============== 类型 ==============
type Status = "active" | "disabled" | "pending";
type Employment = "active" | "resigned" | "paused";

interface InternalUser {
  id: string;
  username: string;
  real_name: string;
  phone: string;
  department: string;
  position: string;
  roles: string[];           // role codes
  employment_status: Employment;
  account_status: Status;
  remark: string;
  last_login_at: string | null; // ISO string or null
  must_change_password: boolean;
}

// ============== mock 数据 ==============
const initialUsers: InternalUser[] = [
  { id: "u1", username: "admin",       real_name: "系统管理员", phone: "", department: "开发组",  position: "管理员",   roles: ["super_admin"], employment_status: "active", account_status: "active", remark: "", last_login_at: "2026-05-29T20:21:00", must_change_password: false },
  { id: "u2", username: "finance01",   real_name: "财务01",     phone: "", department: "财务",    position: "财务",     roles: ["finance"],     employment_status: "active", account_status: "active", remark: "", last_login_at: null, must_change_password: true },
  { id: "u3", username: "operation01", real_name: "运营01",     phone: "", department: "运营组",  position: "运营",     roles: ["operation"],   employment_status: "active", account_status: "active", remark: "", last_login_at: null, must_change_password: true },
  { id: "u4", username: "purchase01",  real_name: "采购01",     phone: "", department: "采购",    position: "采购",     roles: ["purchase"],    employment_status: "active", account_status: "active", remark: "", last_login_at: null, must_change_password: true },
  { id: "u5", username: "service01",   real_name: "客服01",     phone: "", department: "客服",    position: "客服",     roles: ["service"],     employment_status: "active", account_status: "active", remark: "", last_login_at: null, must_change_password: true },
  { id: "u6", username: "warehouse01", real_name: "仓库01",     phone: "", department: "仓库入仓", position: "入库员",   roles: ["wh_in"],       employment_status: "active", account_status: "active", remark: "", last_login_at: null, must_change_password: true },
  { id: "u7", username: "hr01",        real_name: "人事01",     phone: "", department: "人事",    position: "人事",     roles: ["hr"],          employment_status: "active", account_status: "active", remark: "", last_login_at: null, must_change_password: true },
];

// 当前登录用户（mock）— 用于"不能停用自己"逻辑
const CURRENT_USER_ID = "u1";

// ============== 工具 ==============
const usernameRe = /^[a-z0-9_]+$/;
const phoneRe = /^[\d+\-\s]{6,20}$/;

function randomPassword(len = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function formatTime(s: string | null) {
  if (!s) return "从未登录";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function roleName(code: string) {
  return ROLES.find(r => r.code === code)?.name ?? code;
}

function StatusBadge({ value }: { value: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    active:   { label: "正常",   cls: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" },
    disabled: { label: "停用",   cls: "bg-muted text-muted-foreground hover:bg-muted" },
    pending:  { label: "待激活", cls: "bg-amber-100 text-amber-700 hover:bg-amber-100" },
  };
  const it = map[value];
  return <Badge variant="secondary" className={it.cls}>{it.label}</Badge>;
}

// ============== 默认表单 ==============
const emptyForm = {
  id: "",
  username: "",
  real_name: "",
  phone: "",
  department: "",
  position: "",
  employment_status: "active" as Employment,
  account_status: "active" as Status,
  remark: "",
  must_change_password: true,
  initial_password: "",
  roles: [] as string[],
};

// ============== 主组件 ==============
export default function UsersPage() {
  const [users, setUsers] = useState<InternalUser[]>(initialUsers);

  // 筛选
  const [keyword, setKeyword] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // 表单抽屉
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InternalUser | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  // 分配角色抽屉
  const [roleSheetTarget, setRoleSheetTarget] = useState<InternalUser | null>(null);
  const [roleSheetSelected, setRoleSheetSelected] = useState<string[]>([]);

  // 重置密码弹窗
  const [resetTarget, setResetTarget] = useState<InternalUser | null>(null);
  const [resetResult, setResetResult] = useState<{ username: string; password: string } | null>(null);

  // 启用/停用确认
  const [toggleTarget, setToggleTarget] = useState<InternalUser | null>(null);

  // ============== 统计 ==============
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.account_status === "active").length;
    const disabled = users.filter(u => u.account_status === "disabled").length;
    const noRole = users.filter(u => u.roles.length === 0).length;
    const admins = users.filter(u => u.roles.includes("super_admin")).length;
    return { total, active, disabled, noRole, admins };
  }, [users]);

  // ============== 过滤 ==============
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return users.filter(u => {
      if (deptFilter !== "all" && u.department !== deptFilter) return false;
      if (roleFilter !== "all" && !u.roles.includes(roleFilter)) return false;
      if (statusFilter !== "all" && u.account_status !== statusFilter) return false;
      if (kw) {
        const hay = [u.username, u.real_name, u.phone, u.department, u.position]
          .join(" ").toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [users, keyword, deptFilter, roleFilter, statusFilter]);

  const resetFilters = () => {
    setKeyword(""); setDeptFilter("all"); setRoleFilter("all"); setStatusFilter("all");
  };

  // ============== 表单交互 ==============
  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, initial_password: randomPassword() });
    setFormOpen(true);
  };

  const openEdit = (u: InternalUser) => {
    setEditing(u);
    setForm({
      id: u.id,
      username: u.username,
      real_name: u.real_name,
      phone: u.phone,
      department: u.department,
      position: u.position,
      employment_status: u.employment_status,
      account_status: u.account_status,
      remark: u.remark,
      must_change_password: u.must_change_password,
      initial_password: "",
      roles: [...u.roles],
    });
    setFormOpen(true);
  };

  const toggleFormRole = (code: string) => {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(code) ? f.roles.filter(r => r !== code) : [...f.roles, code],
    }));
  };

  const submitForm = () => {
    // 校验
    if (!form.username.trim()) return toast.error("请填写用户名");
    if (!usernameRe.test(form.username.trim()))
      return toast.error("用户名只能使用英文小写、数字、下划线");
    if (!form.real_name.trim()) return toast.error("请填写姓名");
    if (!form.department) return toast.error("请选择部门");
    if (form.phone && !phoneRe.test(form.phone.trim()))
      return toast.error("手机号格式不正确");

    // 用户名查重
    const dup = users.find(u =>
      u.username.toLowerCase() === form.username.trim().toLowerCase()
      && u.id !== form.id,
    );
    if (dup) return toast.error("用户名已存在");

    // 至少一个角色，或允许保存为"待设置角色"
    if (form.roles.length === 0 && !editing) {
      // 创建时允许为空，但状态置为 pending
    }

    if (editing) {
      setUsers(prev => prev.map(u => u.id === editing.id ? {
        ...u,
        username: form.username.trim(),
        real_name: form.real_name.trim(),
        phone: form.phone.trim(),
        department: form.department,
        position: form.position.trim(),
        employment_status: form.employment_status,
        account_status: form.account_status,
        remark: form.remark,
        must_change_password: form.must_change_password,
        roles: form.roles,
      } : u));
      toast.success("用户信息已更新");
    } else {
      const nu: InternalUser = {
        id: `u_${Date.now()}`,
        username: form.username.trim(),
        real_name: form.real_name.trim(),
        phone: form.phone.trim(),
        department: form.department,
        position: form.position.trim(),
        roles: form.roles,
        employment_status: form.employment_status,
        account_status: form.roles.length === 0 ? "pending" : form.account_status,
        remark: form.remark,
        last_login_at: null,
        must_change_password: form.must_change_password,
      };
      setUsers(prev => [nu, ...prev]);
      toast.success("用户已创建");
    }
    setFormOpen(false);
  };

  // ============== 分配角色 ==============
  const openRoleSheet = (u: InternalUser) => {
    setRoleSheetTarget(u);
    setRoleSheetSelected([...u.roles]);
  };
  const toggleSheetRole = (code: string) => {
    setRoleSheetSelected(prev =>
      prev.includes(code) ? prev.filter(r => r !== code) : [...prev, code],
    );
  };
  const saveRoles = () => {
    if (!roleSheetTarget) return;
    setUsers(prev => prev.map(u => u.id === roleSheetTarget.id ? {
      ...u,
      roles: roleSheetSelected,
      account_status: roleSheetSelected.length === 0 && u.account_status === "pending"
        ? "pending"
        : (u.account_status === "pending" && roleSheetSelected.length > 0 ? "active" : u.account_status),
    } : u));
    toast.success("用户角色已更新");
    setRoleSheetTarget(null);
  };

  // ============== 重置密码 ==============
  const confirmReset = () => {
    if (!resetTarget) return;
    const pwd = randomPassword();
    setUsers(prev => prev.map(u => u.id === resetTarget.id
      ? { ...u, must_change_password: true } : u));
    setResetResult({ username: resetTarget.username, password: pwd });
    setResetTarget(null);
    toast.success("临时密码已生成");
  };

  // ============== 启用/停用 ==============
  const requestToggle = (u: InternalUser) => {
    if (u.id === CURRENT_USER_ID && u.account_status === "active") {
      return toast.error("不能停用当前登录账号");
    }
    if (u.roles.includes("super_admin") && u.account_status === "active") {
      const remainAdmins = users.filter(x =>
        x.roles.includes("super_admin") && x.account_status === "active" && x.id !== u.id,
      ).length;
      if (remainAdmins === 0) {
        return toast.error("至少需要保留一个启用的超级管理员账号");
      }
    }
    setToggleTarget(u);
  };
  const confirmToggle = () => {
    if (!toggleTarget) return;
    const next: Status = toggleTarget.account_status === "active" ? "disabled" : "active";
    setUsers(prev => prev.map(u => u.id === toggleTarget.id
      ? { ...u, account_status: next } : u));
    toast.success(next === "active" ? "用户已启用" : "用户已停用");
    setToggleTarget(null);
  };

  // ============== 渲染 ==============
  return (
    <div>
      <PageHeader
        breadcrumb={["系统设置", "用户管理"]}
        title="用户管理"
        description="管理公司内部成员账号、部门岗位和系统角色"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" /> 新建用户
          </Button>
        }
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard icon={<Users className="w-4 h-4" />} label="全部用户" value={stats.total} />
        <StatCard icon={<UserCheck className="w-4 h-4 text-emerald-600" />} label="正常账号" value={stats.active} />
        <StatCard icon={<UserX className="w-4 h-4 text-muted-foreground" />} label="停用账号" value={stats.disabled} />
        <StatCard icon={<ShieldAlert className="w-4 h-4 text-amber-600" />} label="待设置角色" value={stats.noRole} />
        <StatCard icon={<ShieldCheck className="w-4 h-4 text-sky-600" />} label="管理员账号" value={stats.admins} />
      </div>

      {/* 筛选 */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="搜索用户名、姓名、手机号、部门、岗位"
                className="pl-9"
              />
            </div>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="部门" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部部门</SelectItem>
                {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="角色" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {ROLES.map(r => <SelectItem key={r.code} value={r.code}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="状态" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={resetFilters}>
              <RotateCcw className="w-4 h-4 mr-1" /> 重置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 表格 */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>手机号</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>岗位</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最后登录</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                    没有匹配的用户
                  </TableCell>
                </TableRow>
              ) : filtered.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-sm">{u.username}</TableCell>
                  <TableCell>{u.real_name}</TableCell>
                  <TableCell className="text-muted-foreground">{u.phone || "—"}</TableCell>
                  <TableCell>{u.department}</TableCell>
                  <TableCell>{u.position || "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0
                        ? <Badge variant="outline" className="text-amber-600 border-amber-300">待设置</Badge>
                        : u.roles.map(c => (
                          <Badge key={c} variant="secondary" className="font-normal">{roleName(c)}</Badge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge value={u.account_status} /></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatTime(u.last_login_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>编辑</Button>
                      <Button variant="ghost" size="sm" onClick={() => openRoleSheet(u)}>
                        分配角色
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setResetTarget(u)}>
                        <KeyRound className="w-3.5 h-3.5 mr-1" /> 重置密码
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className={u.account_status === "active" ? "text-destructive" : "text-emerald-600"}
                        onClick={() => requestToggle(u)}
                      >
                        <Power className="w-3.5 h-3.5 mr-1" />
                        {u.account_status === "active" ? "停用" : "启用"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 新建 / 编辑 右侧抽屉 */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-[560px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "编辑用户" : "新建用户"}</SheetTitle>
            <SheetDescription>
              {editing ? "更新内部成员账号信息与角色" : "为公司内部成员创建账号"}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 py-5">
            {/* 基础信息 */}
            <Section title="基础信息">
              <Field label="用户名" required>
                <Input
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder="英文小写、数字、下划线"
                />
              </Field>
              <Field label="姓名" required>
                <Input value={form.real_name} onChange={e => setForm({ ...form, real_name: e.target.value })} />
              </Field>
              <Field label="手机号">
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="选填" />
              </Field>
              <Field label="部门" required>
                <Select value={form.department} onValueChange={v => setForm({ ...form, department: v })}>
                  <SelectTrigger><SelectValue placeholder="请选择部门" /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="岗位">
                <Input value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} placeholder="例如 运营 / 主播 / 入库员" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="入职状态">
                  <Select value={form.employment_status} onValueChange={v => setForm({ ...form, employment_status: v as Employment })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="账号状态">
                  <Select value={form.account_status} onValueChange={v => setForm({ ...form, account_status: v as Status })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="备注">
                <Textarea rows={2} value={form.remark} onChange={e => setForm({ ...form, remark: e.target.value })} />
              </Field>
            </Section>

            {/* 登录信息 */}
            {!editing && (
              <Section title="登录信息">
                <Field label="初始密码">
                  <div className="flex gap-2">
                    <Input
                      value={form.initial_password}
                      onChange={e => setForm({ ...form, initial_password: e.target.value })}
                      placeholder="留空将自动生成"
                    />
                    <Button type="button" variant="outline" size="icon"
                      onClick={() => setForm({ ...form, initial_password: randomPassword() })}>
                      <RefreshCcw className="w-4 h-4" />
                    </Button>
                  </div>
                </Field>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">首次登录要求修改密码</Label>
                  <Switch
                    checked={form.must_change_password}
                    onCheckedChange={v => setForm({ ...form, must_change_password: v })}
                  />
                </div>
              </Section>
            )}

            {/* 角色信息 */}
            <Section title="角色信息">
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map(r => (
                  <label key={r.code}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent">
                    <Checkbox
                      checked={form.roles.includes(r.code)}
                      onCheckedChange={() => toggleFormRole(r.code)}
                    />
                    <span className="text-sm">{r.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                可多选，最终权限取所有角色的合集。未选角色将保存为"待设置角色"。
              </p>
            </Section>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={submitForm}>{editing ? "保存" : "创建用户"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 分配角色 右侧抽屉 */}
      <Sheet open={!!roleSheetTarget} onOpenChange={v => !v && setRoleSheetTarget(null)}>
        <SheetContent className="w-full sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>分配角色</SheetTitle>
            <SheetDescription>为用户绑定系统角色，最终权限取多个角色的合集</SheetDescription>
          </SheetHeader>
          {roleSheetTarget && (
            <div className="py-5 space-y-5">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-0.5">
                <div><span className="text-muted-foreground">姓名：</span>{roleSheetTarget.real_name}</div>
                <div><span className="text-muted-foreground">用户名：</span><span className="font-mono">{roleSheetTarget.username}</span></div>
                <div><span className="text-muted-foreground">部门：</span>{roleSheetTarget.department} / {roleSheetTarget.position || "—"}</div>
              </div>
              <div className="space-y-2">
                {ROLES.map(r => (
                  <label key={r.code}
                    className="flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent">
                    <Checkbox
                      checked={roleSheetSelected.includes(r.code)}
                      onCheckedChange={() => toggleSheetRole(r.code)}
                    />
                    <span className="text-sm flex-1">{r.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{r.code}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                角色清单来自「角色权限配置」页面。需要新增或修改角色权限，请到该页面操作。
              </p>
            </div>
          )}
          <SheetFooter>
            <Button variant="outline" onClick={() => setRoleSheetTarget(null)}>取消</Button>
            <Button onClick={saveRoles}>保存</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 重置密码确认 */}
      <AlertDialog open={!!resetTarget} onOpenChange={v => !v && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置密码</AlertDialogTitle>
            <AlertDialogDescription>
              确定要为该用户生成新的临时密码吗？生成后请将密码发给员工，员工首次登录后需要修改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset}>确定生成</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 重置结果 */}
      <Dialog open={!!resetResult} onOpenChange={v => !v && setResetResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>临时密码已生成</DialogTitle>
            <DialogDescription>请尽快复制并发送给员工，关闭弹窗后不会再次显示。</DialogDescription>
          </DialogHeader>
          {resetResult && (
            <div className="space-y-3 py-2">
              <div className="rounded-md border border-border p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">用户名</span>
                  <span className="font-mono">{resetResult.username}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">临时密码</span>
                  <div className="flex items-center gap-2">
                    <code className="bg-muted px-2 py-1 rounded">{resetResult.password}</code>
                    <Button size="icon" variant="outline" onClick={() => {
                      navigator.clipboard.writeText(resetResult.password);
                      toast.success("已复制");
                    }}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                提示：请将临时密码发给员工，员工首次登录后需要修改密码。
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResetResult(null)}>我已复制</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 启用/停用确认 */}
      <AlertDialog open={!!toggleTarget} onOpenChange={v => !v && setToggleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.account_status === "active" ? "停用账号" : "启用账号"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.account_status === "active"
                ? "确定要停用该用户账号吗？停用后该用户将无法登录系统。"
                : "确定要启用该用户账号吗？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggle}>确定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============== 小组件 ==============
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}{label}
        </div>
        <div className="text-2xl font-semibold mt-2">{value}</div>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}
