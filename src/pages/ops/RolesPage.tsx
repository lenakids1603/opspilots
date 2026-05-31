import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ops/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, RotateCw, Settings2, Users, Shield, Search } from "lucide-react";
import { toast } from "sonner";

// ============== 类型 ==============
type RoleStatus = "active" | "disabled";
type PermKey = "view" | "create" | "edit" | "import" | "export";

interface MenuGroup { key: string; name: string }
interface Permissions { [menuKey: string]: { [P in PermKey]?: boolean } }

interface Role {
  id: string;
  role_name: string;
  role_code: string;
  description: string;
  department_scope: string[];
  permissions: Permissions;
  status: RoleStatus;
  is_system: boolean;
  member_count: number;
  updated_at: string;
}

interface Member {
  id: string;
  full_name: string;
  username: string;
  department: string;
  position: string;
  role_ids: string[];
  status: "active" | "disabled";
}

// ============== 常量 ==============
const MENU_GROUPS: MenuGroup[] = [
  { key: "home", name: "系统首页" },
  { key: "ops_analytics", name: "运营分析" },
  { key: "product", name: "商品系统" },
  { key: "service", name: "客服系统" },
  { key: "finance", name: "财务系统" },
  { key: "warehouse", name: "仓库系统" },
  { key: "supplier", name: "供应商系统" },
  { key: "data_center", name: "数据中心" },
  { key: "system", name: "系统设置" },
];

const PERM_KEYS: { key: PermKey; label: string }[] = [
  { key: "view", label: "查看" },
  { key: "create", label: "新增" },
  { key: "edit", label: "编辑" },
  { key: "import", label: "导入" },
  { key: "export", label: "导出" },
];

const DEPT_OPTIONS = [
  "管理层", "开发", "财务", "运营组", "直播组", "采购", "商品",
  "客服", "仓库", "仓库入仓", "人事", "通用",
];

function fullPerms(): Permissions {
  return MENU_GROUPS.reduce((acc, g) => {
    acc[g.key] = { view: true, create: true, edit: true, import: true, export: true };
    return acc;
  }, {} as Permissions);
}
function viewOnly(menus: string[]): Permissions {
  return menus.reduce((acc, k) => { acc[k] = { view: true }; return acc; }, {} as Permissions);
}
function rwPerms(menus: string[]): Permissions {
  return menus.reduce((acc, k) => {
    acc[k] = { view: true, create: true, edit: true, import: true, export: true };
    return acc;
  }, {} as Permissions);
}

// ============== 默认角色 mock 数据 ==============
const NOW = new Date().toISOString();
const INITIAL_ROLES: Role[] = [
  {
    id: "r_admin", role_name: "超级管理员", role_code: "super_admin",
    description: "拥有系统全部权限，可以管理用户、角色、系统设置",
    department_scope: ["管理层", "开发"],
    permissions: fullPerms(), status: "active", is_system: true,
    member_count: 1, updated_at: NOW,
  },
  {
    id: "r_boss", role_name: "老板 / 经营查看", role_code: "boss_view",
    description: "查看经营数据、财务总览、销售、退款、商品、供应商等核心数据",
    department_scope: ["管理层"],
    permissions: viewOnly(["home", "ops_analytics", "product", "finance", "supplier", "data_center"]),
    status: "active", is_system: true, member_count: 1, updated_at: NOW,
  },
  {
    id: "r_finance", role_name: "财务", role_code: "finance",
    description: "维护财务总览、资金流水、供应商账单核对、账务管理、个体户账户管理、额度预警",
    department_scope: ["财务"],
    permissions: { ...rwPerms(["finance", "supplier"]), home: { view: true }, data_center: { view: true, export: true } },
    status: "active", is_system: true, member_count: 2, updated_at: NOW,
  },
  {
    id: "r_ops", role_name: "运营", role_code: "operation",
    description: "查看运营分析、销售分析、退款分析、商品数据",
    department_scope: ["运营组", "直播组"],
    permissions: { ...viewOnly(["home", "ops_analytics", "product", "data_center"]), ops_analytics: { view: true, export: true } },
    status: "active", is_system: true, member_count: 8, updated_at: NOW,
  },
  {
    id: "r_purchase", role_name: "商品 / 采购", role_code: "purchase",
    description: "维护商品系统、供应商系统、采购单、采购超时预警、商品档案",
    department_scope: ["采购", "商品"],
    permissions: rwPerms(["home", "product", "supplier"]),
    status: "active", is_system: true, member_count: 2, updated_at: NOW,
  },
  {
    id: "r_service", role_name: "客服", role_code: "service",
    description: "维护客服系统，包括商品投诉登记、异常退款商品、质量问题分析",
    department_scope: ["客服"],
    permissions: rwPerms(["home", "service", "product"]),
    status: "active", is_system: true, member_count: 5, updated_at: NOW,
  },
  {
    id: "r_wh_in", role_name: "仓库入库", role_code: "warehouse_inbound",
    description: "使用仓库系统的到货登记、入库相关页面",
    department_scope: ["仓库入仓"],
    permissions: { ...rwPerms(["warehouse"]), home: { view: true } },
    status: "active", is_system: true, member_count: 4, updated_at: NOW,
  },
  {
    id: "r_wh_out", role_name: "仓库发货 / 售后", role_code: "warehouse_outbound",
    description: "查看仓库相关页面、售后销退数据",
    department_scope: ["仓库"],
    permissions: { ...rwPerms(["warehouse"]), home: { view: true } },
    status: "active", is_system: true, member_count: 10, updated_at: NOW,
  },
  {
    id: "r_hr", role_name: "人事", role_code: "hr",
    description: "管理内部成员基础信息和人事相关资料",
    department_scope: ["人事"],
    permissions: { ...rwPerms(["system"]), home: { view: true } },
    status: "active", is_system: true, member_count: 2, updated_at: NOW,
  },
  {
    id: "r_readonly", role_name: "普通只读", role_code: "readonly",
    description: "仅能查看被授权的基础页面，不能新增、编辑、删除、导出",
    department_scope: ["通用"],
    permissions: viewOnly(["home"]),
    status: "active", is_system: true, member_count: 3, updated_at: NOW,
  },
];

const INITIAL_MEMBERS: Member[] = [
  { id: "m1", full_name: "财务A", username: "finance01", department: "财务", position: "财务", role_ids: ["r_finance"], status: "active" },
  { id: "m2", full_name: "财务B", username: "finance02", department: "财务", position: "财务", role_ids: ["r_finance"], status: "active" },
  { id: "m3", full_name: "运营A", username: "operation01", department: "运营组", position: "运营", role_ids: ["r_ops"], status: "active" },
  { id: "m4", full_name: "客服A", username: "service01", department: "客服", position: "客服", role_ids: ["r_service"], status: "active" },
  { id: "m5", full_name: "仓库A", username: "warehouse01", department: "仓库入仓", position: "入库", role_ids: ["r_wh_in"], status: "active" },
  { id: "m6", full_name: "采购A", username: "purchase01", department: "采购", position: "采购", role_ids: ["r_purchase"], status: "active" },
  { id: "m7", full_name: "人事A", username: "hr01", department: "人事", position: "人事", role_ids: ["r_hr", "r_finance"], status: "active" },
  { id: "m8", full_name: "管理员", username: "admin", department: "管理层", position: "管理", role_ids: ["r_admin"], status: "active" },
];

const emptyFormRole = {
  role_name: "", role_code: "", description: "",
  department_scope: [] as string[], status: "active" as RoleStatus,
};

// ============== 页面 ==============
export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>(INITIAL_ROLES);
  const [members, setMembers] = useState<Member[]>(INITIAL_MEMBERS);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RoleStatus>("all");
  const [activeId, setActiveId] = useState<string>(INITIAL_ROLES[0].id);

  // dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyFormRole });
  const [editingId, setEditingId] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRoleId, setAssignRoleId] = useState<string | null>(null);
  const [memberKeyword, setMemberKeyword] = useState("");
  const [memberDept, setMemberDept] = useState<string>("all");

  const [savePermConfirm, setSavePermConfirm] = useState(false);
  const [pendingPerms, setPendingPerms] = useState<Permissions | null>(null);

  const [toggleTarget, setToggleTarget] = useState<Role | null>(null);

  const activeRole = useMemo(() => roles.find(r => r.id === activeId) ?? roles[0], [roles, activeId]);

  const filteredRoles = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return roles.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (kw && !r.role_name.toLowerCase().includes(kw) && !r.description.toLowerCase().includes(kw) && !r.role_code.includes(kw)) return false;
      return true;
    });
  }, [roles, keyword, statusFilter]);

  // ------- 操作 -------
  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyFormRole });
    setCreateOpen(true);
  }
  function openEdit(role: Role) {
    setEditingId(role.id);
    setForm({
      role_name: role.role_name, role_code: role.role_code,
      description: role.description, department_scope: role.department_scope,
      status: role.status,
    });
    setCreateOpen(true);
  }
  function submitForm() {
    if (!form.role_name.trim()) return toast.error("请填写角色名称");
    if (!form.role_code.trim()) return toast.error("请填写角色编码");
    if (!/^[a-z0-9_]+$/.test(form.role_code)) return toast.error("角色编码只能使用英文小写字母、数字和下划线");

    if (editingId) {
      const target = roles.find(r => r.id === editingId);
      if (!target) return;
      setRoles(prev => prev.map(r => r.id === editingId ? {
        ...r,
        role_name: form.role_name.trim(),
        role_code: target.is_system ? r.role_code : form.role_code.trim(),
        description: form.description,
        department_scope: form.department_scope,
        status: target.is_system && target.role_code === "super_admin" ? "active" : form.status,
        updated_at: new Date().toISOString(),
      } : r));
      toast.success("角色信息已更新");
    } else {
      if (roles.some(r => r.role_code === form.role_code.trim())) return toast.error("角色编码已存在");
      const newRole: Role = {
        id: `r_${Date.now()}`,
        role_name: form.role_name.trim(),
        role_code: form.role_code.trim(),
        description: form.description,
        department_scope: form.department_scope,
        permissions: viewOnly(["home"]),
        status: form.status, is_system: false, member_count: 0,
        updated_at: new Date().toISOString(),
      };
      setRoles(prev => [...prev, newRole]);
      setActiveId(newRole.id);
      toast.success("角色已创建");
    }
    setCreateOpen(false);
  }

  function togglePermLocal(menuKey: string, perm: PermKey, checked: boolean) {
    setRoles(prev => prev.map(r => r.id === activeId ? {
      ...r,
      permissions: {
        ...r.permissions,
        [menuKey]: {
          ...(r.permissions[menuKey] ?? {}),
          [perm]: checked,
          // 取消查看时清空其它
          ...(perm === "view" && !checked ? { create: false, edit: false, import: false, export: false } : {}),
        },
      },
    } : r));
  }

  function requestSavePerms() {
    setPendingPerms(activeRole.permissions);
    setSavePermConfirm(true);
  }
  function confirmSavePerms() {
    setRoles(prev => prev.map(r => r.id === activeId ? { ...r, updated_at: new Date().toISOString() } : r));
    setSavePermConfirm(false);
    setPendingPerms(null);
    toast.success("角色权限已保存");
  }

  function toggleStatus(role: Role) {
    if (role.role_code === "super_admin") return toast.error("超级管理员角色不能停用");
    setToggleTarget(role);
  }
  function confirmToggleStatus() {
    if (!toggleTarget) return;
    const next: RoleStatus = toggleTarget.status === "active" ? "disabled" : "active";
    setRoles(prev => prev.map(r => r.id === toggleTarget.id ? { ...r, status: next, updated_at: new Date().toISOString() } : r));
    toast.success(next === "active" ? "角色已启用" : "角色已停用");
    setToggleTarget(null);
  }

  function openAssign(role: Role) {
    setAssignRoleId(role.id);
    setMemberKeyword("");
    setMemberDept("all");
    setAssignOpen(true);
  }
  function toggleMemberRole(memberId: string, checked: boolean) {
    if (!assignRoleId) return;
    setMembers(prev => prev.map(m => {
      if (m.id !== memberId) return m;
      const set = new Set(m.role_ids);
      if (checked) set.add(assignRoleId); else set.delete(assignRoleId);
      return { ...m, role_ids: Array.from(set) };
    }));
  }
  function saveAssign() {
    if (!assignRoleId) return;
    const count = members.filter(m => m.role_ids.includes(assignRoleId)).length;
    setRoles(prev => prev.map(r => r.id === assignRoleId ? { ...r, member_count: count, updated_at: new Date().toISOString() } : r));
    toast.success("成员角色已更新");
    setAssignOpen(false);
  }

  // ------- 渲染辅助 -------
  const departmentOptions = DEPT_OPTIONS;

  const summary = useMemo(() => {
    const allowedMenus: string[] = [];
    const allActions = new Set<string>();
    const restrictedMenus: string[] = [];
    for (const g of MENU_GROUPS) {
      const p = activeRole?.permissions?.[g.key] ?? {};
      if (p.view) {
        allowedMenus.push(g.name);
        for (const pk of PERM_KEYS) if (p[pk.key]) allActions.add(pk.label);
      } else {
        restrictedMenus.push(g.name);
      }
    }
    return { allowedMenus, actions: Array.from(allActions), restrictedMenus };
  }, [activeRole]);

  const assignRole = roles.find(r => r.id === assignRoleId);
  const filteredMembers = members.filter(m => {
    if (memberDept !== "all" && m.department !== memberDept) return false;
    const kw = memberKeyword.trim().toLowerCase();
    if (kw && !m.full_name.toLowerCase().includes(kw) && !m.username.toLowerCase().includes(kw)) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        breadcrumb={["系统设置", "角色权限配置"]}
        title="角色权限配置"
        description="管理公司内部成员的系统访问范围和操作权限"
        actions={<Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> 新建角色</Button>}
      />

      {/* 筛选 */}
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索角色名称、说明、编码"
              className="pl-8 w-72"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">启用</SelectItem>
              <SelectItem value="disabled">停用</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => { setKeyword(""); setStatusFilter("all"); }}>
            <RotateCw className="w-4 h-4 mr-1" /> 重置
          </Button>
          <div className="text-xs text-muted-foreground ml-auto">共 {filteredRoles.length} 个角色</div>
        </CardContent>
      </Card>

      {/* 列表-详情 主区 */}
      <div className="grid grid-cols-12 gap-4 items-start">
        {/* 左侧：紧凑角色列表 */}
        <Card className="col-span-12 lg:col-span-4 xl:col-span-3 lg:sticky lg:top-4">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">角色列表</h3>
            <span className="text-xs text-muted-foreground">{filteredRoles.length}</span>
          </div>
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
            {filteredRoles.map(r => {
              const selected = r.id === activeId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border/60 hover:bg-muted/40 transition-colors ${selected ? "bg-ops-sky/5 border-l-2 border-l-ops-sky" : "border-l-2 border-l-transparent"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{r.role_name}</span>
                    {r.is_system ? (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0">系统</Badge>
                    ) : r.status === "active" ? (
                      <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">启用</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px] px-1.5 py-0">停用</Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{r.role_code}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center justify-between">
                    <span className="truncate">{r.department_scope.join(" / ") || "—"}</span>
                    <span className="ml-2 inline-flex items-center gap-1"><Users className="w-3 h-3" />{r.member_count}</span>
                  </div>
                </button>
              );
            })}
            {filteredRoles.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-10">没有匹配的角色</div>
            )}
          </div>
        </Card>

        {/* 右侧：详情 */}
        <Card className="col-span-12 lg:col-span-8 xl:col-span-9">
          {activeRole && (
            <>
              {/* 详情 Header */}
              <div className="px-5 py-4 border-b border-border flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-ops-sky" />
                    <h2 className="text-base font-semibold">{activeRole.role_name}</h2>
                    {activeRole.is_system && (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">系统默认</Badge>
                    )}
                    {!activeRole.is_system && (activeRole.status === "active"
                      ? <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">启用</Badge>
                      : <Badge variant="outline" className="bg-muted text-muted-foreground border-border">停用</Badge>)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <span>编码：<span className="font-mono text-foreground/80">{activeRole.role_code}</span></span>
                    <span>适用部门：{activeRole.department_scope.join(" / ") || "—"}</span>
                    <span>成员：{activeRole.member_count}</span>
                    <span>更新：{new Date(activeRole.updated_at).toLocaleString("zh-CN")}</span>
                  </div>
                  {activeRole.description && (
                    <p className="text-xs text-muted-foreground mt-2 max-w-3xl">{activeRole.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => openEdit(activeRole)}>编辑信息</Button>
                  <Button size="sm" variant="outline" onClick={() => openAssign(activeRole)}>
                    <Users className="w-3.5 h-3.5 mr-1" />分配成员
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    disabled={activeRole.role_code === "super_admin"}
                    onClick={() => toggleStatus(activeRole)}
                  >
                    {activeRole.status === "active" ? "停用角色" : "启用角色"}
                  </Button>
                  <Button size="sm" onClick={requestSavePerms}>保存权限</Button>
                </div>
              </div>

              {/* Tabs */}
              <Tabs defaultValue="perms" className="p-5">
                <TabsList>
                  <TabsTrigger value="perms">菜单权限</TabsTrigger>
                  <TabsTrigger value="summary">权限摘要</TabsTrigger>
                  <TabsTrigger value="members">成员（{members.filter(m => m.role_ids.includes(activeRole.id)).length}）</TabsTrigger>
                </TabsList>

                {/* 菜单权限 */}
                <TabsContent value="perms" className="mt-4">
                  <div className="border border-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-48">一级菜单</TableHead>
                          {PERM_KEYS.map(p => (
                            <TableHead key={p.key} className="text-center">{p.label}</TableHead>
                          ))}
                          <TableHead className="text-center w-20">全选</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {MENU_GROUPS.map(g => {
                          const p = activeRole.permissions?.[g.key] ?? {};
                          const allOn = PERM_KEYS.every(k => p[k.key]);
                          return (
                            <TableRow key={g.key}>
                              <TableCell className="font-medium text-sm">{g.name}</TableCell>
                              {PERM_KEYS.map(pk => (
                                <TableCell key={pk.key} className="text-center">
                                  <Checkbox
                                    checked={!!p[pk.key]}
                                    disabled={pk.key !== "view" && !p.view}
                                    onCheckedChange={(v) => togglePermLocal(g.key, pk.key, !!v)}
                                  />
                                </TableCell>
                              ))}
                              <TableCell className="text-center">
                                <Checkbox
                                  checked={allOn}
                                  onCheckedChange={(v) => {
                                    const on = !!v;
                                    PERM_KEYS.forEach(k => togglePermLocal(g.key, k.key, on));
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">提示：取消「查看」会自动清空该菜单下的其它操作权限。修改后请点击右上角「保存权限」。</p>
                </TabsContent>

                {/* 权限摘要 */}
                <TabsContent value="summary" className="mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="border border-border rounded-md p-4">
                      <div className="text-xs text-muted-foreground mb-2">可访问菜单</div>
                      <div className="flex flex-wrap gap-1.5">
                        {summary.allowedMenus.length
                          ? summary.allowedMenus.map(m => (
                              <Badge key={m} variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{m}</Badge>
                            ))
                          : <span className="text-xs text-muted-foreground">无</span>}
                      </div>
                    </div>
                    <div className="border border-border rounded-md p-4">
                      <div className="text-xs text-muted-foreground mb-2">可执行操作</div>
                      <div className="flex flex-wrap gap-1.5">
                        {summary.actions.length
                          ? summary.actions.map(a => (
                              <Badge key={a} variant="outline" className="bg-ops-sky/10 text-ops-sky border-ops-sky/30">{a}</Badge>
                            ))
                          : <span className="text-xs text-muted-foreground">无</span>}
                      </div>
                    </div>
                    <div className="border border-border rounded-md p-4">
                      <div className="text-xs text-muted-foreground mb-2">受限菜单</div>
                      <div className="flex flex-wrap gap-1.5">
                        {summary.restrictedMenus.length
                          ? summary.restrictedMenus.map(m => (
                              <Badge key={m} variant="outline" className="bg-muted text-muted-foreground border-border">{m}</Badge>
                            ))
                          : <span className="text-xs text-muted-foreground">无</span>}
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* 成员 */}
                <TabsContent value="members" className="mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs text-muted-foreground">该角色当前包含的成员</div>
                    <Button size="sm" variant="outline" onClick={() => openAssign(activeRole)}>
                      <Users className="w-3.5 h-3.5 mr-1" />管理成员
                    </Button>
                  </div>
                  <div className="border border-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>姓名</TableHead>
                          <TableHead>登录账号</TableHead>
                          <TableHead>部门</TableHead>
                          <TableHead>岗位</TableHead>
                          <TableHead>其他角色</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.filter(m => m.role_ids.includes(activeRole.id)).map(m => (
                          <TableRow key={m.id}>
                            <TableCell className="text-sm">{m.full_name}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{m.username}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{m.department}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{m.position}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {m.role_ids.filter(id => id !== activeRole.id).map(id => {
                                  const r = roles.find(x => x.id === id);
                                  return r ? (
                                    <Badge key={id} variant="outline" className="text-[10px] px-1.5 py-0">{r.role_name}</Badge>
                                  ) : null;
                                })}
                                {m.role_ids.length === 1 && <span className="text-xs text-muted-foreground">—</span>}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {members.filter(m => m.role_ids.includes(activeRole.id)).length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">该角色暂无成员，点击「管理成员」分配</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </Card>
      </div>


      {/* 新建 / 编辑角色 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑角色" : "新建角色"}</DialogTitle>
            <DialogDescription>填写角色基础信息，权限可在右侧菜单权限区域配置</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>角色名称 <span className="text-destructive">*</span></Label>
              <Input value={form.role_name} onChange={e => setForm({ ...form, role_name: e.target.value })} placeholder="例如：财务" />
            </div>
            <div>
              <Label>角色编码 <span className="text-destructive">*</span></Label>
              <Input
                value={form.role_code}
                disabled={!!editingId && !!roles.find(r => r.id === editingId)?.is_system}
                onChange={e => setForm({ ...form, role_code: e.target.value.toLowerCase() })}
                placeholder="finance / operation / warehouse_inbound"
                className="font-mono"
              />
              {editingId && roles.find(r => r.id === editingId)?.is_system && (
                <p className="text-xs text-muted-foreground mt-1">系统默认角色不允许修改编码</p>
              )}
            </div>
            <div>
              <Label>适用部门（多选）</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {DEPT_OPTIONS.map(d => {
                  const on = form.department_scope.includes(d);
                  return (
                    <Badge
                      key={d}
                      variant="outline"
                      className={`cursor-pointer ${on ? "bg-ops-sky/10 text-ops-sky border-ops-sky" : ""}`}
                      onClick={() => setForm(f => ({
                        ...f,
                        department_scope: on ? f.department_scope.filter(x => x !== d) : [...f.department_scope, d],
                      }))}
                    >{d}</Badge>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>角色说明</Label>
              <Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>初始状态</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{form.status === "active" ? "启用" : "停用"}</span>
                <Switch
                  checked={form.status === "active"}
                  onCheckedChange={v => setForm({ ...form, status: v ? "active" : "disabled" })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={submitForm}>{editingId ? "保存" : "创建"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 分配成员 */}
      <Sheet open={assignOpen} onOpenChange={setAssignOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>分配成员 — {assignRole?.role_name}</SheetTitle>
            <SheetDescription>勾选即加入该角色，一个成员可以同时拥有多个角色</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="搜索姓名 / 账号" value={memberKeyword} onChange={e => setMemberKeyword(e.target.value)} />
              <Select value={memberDept} onValueChange={setMemberDept}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部部门</SelectItem>
                  {departmentOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="border border-border rounded-md max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>账号</TableHead>
                    <TableHead>部门</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map(m => {
                    const checked = assignRoleId ? m.role_ids.includes(assignRoleId) : false;
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <Checkbox checked={checked} onCheckedChange={v => toggleMemberRole(m.id, !!v)} />
                        </TableCell>
                        <TableCell className="text-sm">{m.full_name}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{m.username}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.department}</TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredMembers.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">没有匹配的成员</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAssignOpen(false)}>取消</Button>
              <Button onClick={saveAssign}>保存</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* 保存权限确认 */}
      <AlertDialog open={savePermConfirm} onOpenChange={setSavePermConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定要修改该角色权限吗？</AlertDialogTitle>
            <AlertDialogDescription>修改后会影响该角色下所有成员的访问范围。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSavePerms}>确认保存</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 启停确认 */}
      <AlertDialog open={!!toggleTarget} onOpenChange={(v) => !v && setToggleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.status === "active" ? "停用该角色？" : "启用该角色？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.status === "active"
                ? "停用后该角色下的成员将失去对应菜单的访问权限。"
                : "启用后该角色下的成员将恢复对应菜单的访问权限。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggleStatus}>确认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
