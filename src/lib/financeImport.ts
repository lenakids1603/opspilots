import * as XLSX from "xlsx";
import { todayCN } from "@/lib/datetime";
import { supabase } from "@/integrations/supabase/client";

export type RowStatus = "new" | "update" | "skip" | "error";
export type RowKind = "entity" | "bank" | "shop" | "binding" | "category";

export interface PreviewRow {
  sheet: string;
  rowNum: number;
  kind: RowKind;
  status: RowStatus;
  message?: string;
  data: Record<string, any>;
  raw: Record<string, any>;
  // for legacy bank rows, the user must confirm the account type before commit
  needsAccountType?: boolean;
}

export interface ImportPreview {
  entities: PreviewRow[];
  banks: PreviewRow[];
  shops: PreviewRow[];
  bindings: PreviewRow[];
  categories: PreviewRow[];
}

export interface ExistingContext {
  entities: { id: string; name: string; code: string | null; legal_person: string | null; entity_type: string }[];
  banks: { id: string; account_number: string | null; account_no_masked: string | null; bank_name: string | null; account_holder_name: string | null }[];
  shops: { id: string; name: string; platform_id: string; entity_id: string | null }[];
  platforms: { id: string; name: string; code: string }[];
  categories: { id: string; direction: string; name: string }[];
  bindings: { id: string; shop_id: string; bank_account_id: string; binding_type: string }[];
}

const norm = (s: any) => (s == null ? "" : String(s).trim());
const normKey = (s: any) => norm(s).toLowerCase();
const normAcc = (s: any) => norm(s).replace(/\s+/g, "");
const toNum = (s: any): number | null => {
  if (s === "" || s == null) return null;
  const n = Number(String(s).replace(/[,，¥$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// ---- DB enum mappings (keep existing DB values) ----
// business_entity_type DB enum is only: individual | company
export const ENTITY_TYPE_MAP: Record<string, string> = {
  个体户: "individual", 个体: "individual", 个体工商户: "individual", 供应商: "individual",
  运营公司: "company", 投流公司: "company", 公司: "company", 其他: "company",
  individual: "individual", company: "company",
};
export const ENTITY_TYPE_LABEL: Record<string, string> = { individual: "个体户", company: "运营公司" };

export const ACCOUNT_TYPE_MAP: Record<string, string> = {
  对公: "corporate", 对公账户: "corporate", 公户: "corporate", corporate: "corporate",
  个人: "personal", 个人账户: "personal", 私户: "personal", personal: "personal",
};
export const ACCOUNT_TYPE_LABEL: Record<string, string> = { corporate: "对公账户", personal: "个人账户" };

export const USAGE_MAP: Record<string, string> = {
  收款: "collection", collection: "collection",
  付款: "payment", payment: "payment",
  投流: "ads", ads: "ads",
  运营服务费: "operation_fee", operation_fee: "operation_fee",
  备用: "backup", backup: "backup",
  其他: "other", other: "other",
};
export const USAGE_LABEL: Record<string, string> = {
  collection: "收款", payment: "付款", ads: "投流", operation_fee: "运营服务费", backup: "备用", other: "其他",
};

export const BINDING_TYPE_MAP: Record<string, string> = {
  收款: "collection", 付款: "payment", 投流: "ads", 备用: "backup", 其他: "other",
  collection: "collection", payment: "payment", ads: "ads", backup: "backup", other: "other",
};
export const BINDING_TYPE_LABEL: Record<string, string> = {
  collection: "收款", payment: "付款", ads: "投流", backup: "备用", other: "其他",
};

const STATUS_MAP: Record<string, string> = {
  启用: "active", 运营中: "active", active: "active",
  停用: "disabled", 暂停: "disabled", 禁用: "disabled", disabled: "disabled", inactive: "disabled",
};
const DIRECTION_MAP: Record<string, string> = {
  收入: "in", in: "in", 支出: "out", out: "out", 内部转账: "transfer", transfer: "transfer",
};
const YES_MAP = new Set(["是", "y", "yes", "true", "1"]);

function findSheet(wb: XLSX.WorkBook, ...candidates: string[]): XLSX.WorkSheet | null {
  for (const c of candidates) {
    const found = wb.SheetNames.find(n => n === c || n.includes(c));
    if (found) return wb.Sheets[found];
  }
  return null;
}

const ACCOUNT_TYPE_PENDING = "pending";

export function parseAccountWorkbook(file: ArrayBuffer, existing: ExistingContext): ImportPreview {
  const wb = XLSX.read(file, { type: "array" });
  const out: ImportPreview = { entities: [], banks: [], shops: [], bindings: [], categories: [] };

  const entityByNormName = new Map<string, any>();
  const entityByCode = new Map<string, any>();
  existing.entities.forEach(e => {
    entityByNormName.set(`${normKey(e.name)}|${e.entity_type}`, e);
    // also keep a name-only lookup that resolves to first match
    if (!entityByNormName.has(normKey(e.name))) entityByNormName.set(normKey(e.name), e);
    if (e.code) entityByCode.set(normKey(e.code), e);
  });
  const bankByAcc = new Map<string, any>();
  existing.banks.forEach(b => {
    const a = normAcc(b.account_number || b.account_no_masked || "");
    if (a) bankByAcc.set(a, b);
  });
  const platformByName = new Map(existing.platforms.map(p => [normKey(p.name), p]));
  const platformByCode = new Map(existing.platforms.map(p => [normKey(p.code), p]));
  const shopByKey = new Map(existing.shops.map(s => [`${s.platform_id}|${normKey(s.name)}`, s]));
  const catByKey = new Map(existing.categories.map(c => [`${c.direction}|${normKey(c.name)}`, c]));
  const bindingByKey = new Map(existing.bindings.map(b => [`${b.shop_id}|${b.bank_account_id}|${b.binding_type}`, b]));

  const seenEntities = new Map<string, number>();
  const seenBanks = new Map<string, number>();
  const seenShops = new Map<string, number>();
  const seenCats = new Map<string, number>();
  const seenBindings = new Map<string, number>();
  const plannedEntities = new Map<string, { entity_type: string }>();

  const resolvePlatform = (v: string) => platformByName.get(normKey(v)) ?? platformByCode.get(normKey(v)) ?? null;
  const resolveEntity = (v: string): { name: string; type?: string } | null => {
    const k = normKey(v);
    if (!k) return null;
    const direct = entityByNormName.get(k);
    if (direct) return { name: direct.name, type: direct.entity_type };
    for (const t of ["individual", "company"]) {
      const hit = entityByNormName.get(`${k}|${t}`);
      if (hit) return { name: hit.name, type: hit.entity_type };
    }
    if (entityByCode.has(k)) {
      const hit = entityByCode.get(k);
      return { name: hit.name, type: hit.entity_type };
    }
    if (plannedEntities.has(k)) return { name: v, type: plannedEntities.get(k)!.entity_type };
    return null;
  };

  /* ========== 经营主体 ========== */
  const sheetEntities = findSheet(wb, "经营主体");
  if (sheetEntities) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetEntities, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const name = norm(r["主体名称*"] ?? r["主体名称"] ?? r["名称"]);
      const code = norm(r["主体简称"] ?? r["编码"] ?? r["主体编码"] ?? r["主体简称/编码"]);
      const typeRaw = norm(r["主体类型*"] ?? r["主体类型"] ?? r["类型"] ?? r["主体类型*(个体户/运营公司/其他)"]);
      const legal = norm(r["法人"] ?? r["法人代表"] ?? r["法人 / 负责人"] ?? r["负责人"]);
      const limit = toNum(r["年度流水额度"]);
      const statusRaw = norm(r["状态"] ?? r["状态(启用/停用)"]);
      const remark = norm(r["备注"]);

      if (!name) { out.entities.push({ sheet: "经营主体", rowNum, kind: "entity", status: "error", message: "主体名称必填", data: {}, raw: r }); return; }
      if (typeRaw && !ENTITY_TYPE_MAP[typeRaw]) {
        out.entities.push({ sheet: "经营主体", rowNum, kind: "entity", status: "error", message: `主体类型无效: ${typeRaw}`, data: {}, raw: r }); return;
      }
      const entity_type = ENTITY_TYPE_MAP[typeRaw] ?? "individual";
      const status = STATUS_MAP[statusRaw] ?? "active";
      const key = `${normKey(name)}|${entity_type}`;
      if (seenEntities.has(key)) {
        out.entities.push({ sheet: "经营主体", rowNum, kind: "entity", status: "skip", message: `文件内重复（第 ${seenEntities.get(key)} 行）`, data: {}, raw: r }); return;
      }
      seenEntities.set(key, rowNum);
      const existingRow = entityByNormName.get(key) ?? (code ? entityByCode.get(normKey(code)) : undefined);
      const payload: any = {
        name, code: code || null, entity_type, legal_person: legal || null,
        annual_flow_limit: limit ?? 5_000_000, status, remark: remark || "",
      };
      if (existingRow) out.entities.push({ sheet: "经营主体", rowNum, kind: "entity", status: "update", data: { ...payload, __id: existingRow.id }, raw: r });
      else { plannedEntities.set(normKey(name), { entity_type }); out.entities.push({ sheet: "经营主体", rowNum, kind: "entity", status: "new", data: payload, raw: r }); }
    });
  }

  /* ========== 银行账户 ========== */
  const sheetBanks = findSheet(wb, "银行账户");
  if (sheetBanks) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetBanks, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const holder = norm(r["开户名*"] ?? r["开户名"]);
      const acctTypeRaw = norm(r["账户类型*"] ?? r["账户类型"]);
      const bank = norm(r["开户银行*"] ?? r["开户银行"] ?? r["银行"]);
      const accNoRaw = norm(r["银行账号*"] ?? r["银行账号"] ?? r["账号"]);
      const accNo = normAcc(accNoRaw);
      const ownerRaw = norm(r["账户法定归属主体"] ?? r["所属主体"] ?? r["所属主体*"]);
      const relatedRaw = norm(r["关联主体"]);
      const personName = norm(r["关联人"] ?? r["关联人 / 持卡人"] ?? r["持卡人"]);
      const usageRawIn = norm(r["用途*"] ?? r["用途"] ?? r["账户用途"]);
      const usageRaw = usageRawIn || "其他";
      const balance = toNum(r["当前余额"]) ?? 0;
      const isDefault = YES_MAP.has(norm(r["是否默认"] ?? r["默认"]).toLowerCase());
      const statusRaw = norm(r["状态"] ?? r["状态(启用/停用)"]);
      const remark = norm(r["备注"]);

      if (!holder) return out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "error", message: "开户名必填", data: {}, raw: r }) && void 0;
      if (!acctTypeRaw || !ACCOUNT_TYPE_MAP[acctTypeRaw]) return out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "error", message: `账户类型无效: ${acctTypeRaw || "(空)"}`, data: {}, raw: r }) && void 0;
      if (!bank) return out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "error", message: "开户银行必填", data: {}, raw: r }) && void 0;
      if (!accNo) return out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "error", message: "银行账号必填", data: {}, raw: r }) && void 0;
      if (!USAGE_MAP[usageRaw]) return out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "error", message: `用途无效: ${usageRaw}`, data: {}, raw: r }) && void 0;

      const account_type = ACCOUNT_TYPE_MAP[acctTypeRaw];
      const usage_type = USAGE_MAP[usageRaw];

      let owner_entity_name = "";
      let related_entity_name = "";
      if (ownerRaw) {
        const o = resolveEntity(ownerRaw);
        if (!o && account_type === "corporate") {
          return out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "error", message: `找不到归属主体【${ownerRaw}】`, data: {}, raw: r }) && void 0;
        }
        owner_entity_name = o?.name ?? ownerRaw;
      } else if (account_type === "corporate") {
        return out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "error", message: "对公账户必须填写账户法定归属主体", data: {}, raw: r }) && void 0;
      }
      if (relatedRaw) {
        const o = resolveEntity(relatedRaw);
        related_entity_name = o?.name ?? relatedRaw;
      }

      if (seenBanks.has(accNo)) return out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "skip", message: `文件内重复账号（第 ${seenBanks.get(accNo)} 行）`, data: {}, raw: r }) && void 0;
      seenBanks.set(accNo, rowNum);

      const status = STATUS_MAP[statusRaw] ?? "active";
      const existingRow = bankByAcc.get(accNo);
      const payload: any = {
        account_holder_name: holder, account_type,
        bank_name: bank, account_number: accNoRaw, account_no_masked: accNoRaw,
        owner_entity_name: owner_entity_name || null,
        related_entity_name: related_entity_name || null,
        related_person_name: personName || null,
        usage_type, is_default: isDefault, current_balance: balance,
        status, remark: remark || "",
      };
      if (existingRow) out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "update", data: { ...payload, __id: existingRow.id }, raw: r });
      else out.banks.push({ sheet: "银行账户", rowNum, kind: "bank", status: "new", data: payload, raw: r });
    });
  }

  /* ========== 店铺 ========== */
  const sheetShops = findSheet(wb, "店铺");
  if (sheetShops) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetShops, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const shopName = norm(r["店铺名称*"] ?? r["店铺名称"] ?? r["店铺"] ?? r["名称"]);
      const platformRaw = norm(r["平台*"] ?? r["平台"] ?? r["平台*(抖音/淘宝/天猫/快手/小红书/其他)"]);
      const entityName = norm(r["经营主体*"] ?? r["经营主体"] ?? r["所属主体"] ?? r["公司"]);
      const statusRaw = norm(r["店铺状态"] ?? r["状态"] ?? r["店铺状态(运营中/暂停/停用)"]);
      const remark = norm(r["备注"]);
      if (!shopName) return out.shops.push({ sheet: "店铺", rowNum, kind: "shop", status: "error", message: "店铺名称必填", data: {}, raw: r }) && void 0;
      if (!platformRaw) return out.shops.push({ sheet: "店铺", rowNum, kind: "shop", status: "error", message: "平台必填", data: {}, raw: r }) && void 0;
      const platform = resolvePlatform(platformRaw);
      if (!platform) return out.shops.push({ sheet: "店铺", rowNum, kind: "shop", status: "error", message: `平台无效: ${platformRaw}`, data: {}, raw: r }) && void 0;
      if (!entityName) return out.shops.push({ sheet: "店铺", rowNum, kind: "shop", status: "error", message: "经营主体必填", data: {}, raw: r }) && void 0;
      const ent = resolveEntity(entityName);
      if (!ent) return out.shops.push({ sheet: "店铺", rowNum, kind: "shop", status: "error", message: `找不到经营主体【${entityName}】`, data: {}, raw: r }) && void 0;

      const key = `${platform.id}|${normKey(shopName)}`;
      if (seenShops.has(key)) return out.shops.push({ sheet: "店铺", rowNum, kind: "shop", status: "skip", message: `文件内重复（第 ${seenShops.get(key)} 行）`, data: {}, raw: r }) && void 0;
      seenShops.set(key, rowNum);
      const status = STATUS_MAP[statusRaw] ?? "active";
      const existingRow = shopByKey.get(key);
      const payload: any = { name: shopName, platform_id: platform.id, platformName: platform.name, entityName: ent.name, status, remark: remark || "" };
      if (existingRow) out.shops.push({ sheet: "店铺", rowNum, kind: "shop", status: "update", data: { ...payload, __id: existingRow.id }, raw: r });
      else out.shops.push({ sheet: "店铺", rowNum, kind: "shop", status: "new", data: payload, raw: r });
    });
  }

  /* ========== 店铺账户绑定 ========== */
  const sheetBindings = findSheet(wb, "店铺账户绑定", "绑定");
  if (sheetBindings) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetBindings, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const shopName = norm(r["店铺名称*"] ?? r["店铺名称"] ?? r["店铺"]);
      const platformRaw = norm(r["平台*"] ?? r["平台"]);
      const accNoRaw = norm(r["银行账号*"] ?? r["银行账号"] ?? r["账号"]);
      const accNo = normAcc(accNoRaw);
      const bindRaw = norm(r["绑定类型*"] ?? r["绑定类型"]);
      const isDefault = YES_MAP.has(norm(r["是否默认"]).toLowerCase());
      const effFrom = norm(r["生效日期"]);
      const effTo = norm(r["失效日期"]);
      const statusRaw = norm(r["状态"]);
      const remark = norm(r["备注"]);
      if (!shopName) return out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "error", message: "店铺名称必填", data: {}, raw: r }) && void 0;
      if (!platformRaw) return out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "error", message: "平台必填", data: {}, raw: r }) && void 0;
      const platform = resolvePlatform(platformRaw);
      if (!platform) return out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "error", message: `平台无效: ${platformRaw}`, data: {}, raw: r }) && void 0;
      if (!accNo) return out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "error", message: "银行账号必填", data: {}, raw: r }) && void 0;
      if (!bindRaw || !BINDING_TYPE_MAP[bindRaw]) return out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "error", message: `绑定类型无效: ${bindRaw}`, data: {}, raw: r }) && void 0;
      const binding_type = BINDING_TYPE_MAP[bindRaw];
      const shopKey = `${platform.id}|${normKey(shopName)}`;
      if (!shopByKey.has(shopKey) && !seenShops.has(shopKey)) {
        return out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "error", message: `找不到店铺【${shopName}@${platform.name}】`, data: {}, raw: r }) && void 0;
      }
      if (!bankByAcc.has(accNo) && !seenBanks.has(accNo)) {
        return out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "error", message: `找不到银行账号【${accNoRaw}】`, data: {}, raw: r }) && void 0;
      }
      const dedupKey = `${shopKey}|${accNo}|${binding_type}`;
      if (seenBindings.has(dedupKey)) return out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "skip", message: `文件内重复（第 ${seenBindings.get(dedupKey)} 行）`, data: {}, raw: r }) && void 0;
      seenBindings.set(dedupKey, rowNum);
      const status = STATUS_MAP[statusRaw] ?? "active";
      const payload: any = {
        shopName, platformName: platform.name, platform_id: platform.id, accountNo: accNoRaw,
        binding_type, is_default: isDefault,
        effective_from: effFrom || null, effective_to: effTo || null,
        status, remark: remark || "",
      };
      // existing detection requires post-resolution shop_id/bank_account_id; mark as new and let commit upsert.
      out.bindings.push({ sheet: "店铺账户绑定", rowNum, kind: "binding", status: "new", data: payload, raw: r });
    });
  }

  /* ========== 收支分类 ========== */
  const sheetCats = findSheet(wb, "收支分类");
  if (sheetCats) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetCats, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const name = norm(r["分类名称*"] ?? r["分类名称"] ?? r["名称"]);
      const dirRaw = norm(r["收支方向*"] ?? r["收支方向"] ?? r["方向"]);
      const sort = toNum(r["排序"]) ?? 100;
      const statusRaw = norm(r["状态"] ?? r["是否启用"]);
      const remark = norm(r["备注"]);
      if (!name) return out.categories.push({ sheet: "收支分类", rowNum, kind: "category", status: "error", message: "分类名称必填", data: {}, raw: r }) && void 0;
      const direction = DIRECTION_MAP[dirRaw];
      if (!direction) return out.categories.push({ sheet: "收支分类", rowNum, kind: "category", status: "error", message: `收支方向无效: ${dirRaw || "(空)"}`, data: {}, raw: r }) && void 0;
      const key = `${direction}|${normKey(name)}`;
      if (seenCats.has(key)) return out.categories.push({ sheet: "收支分类", rowNum, kind: "category", status: "skip", message: `文件内重复（第 ${seenCats.get(key)} 行）`, data: {}, raw: r }) && void 0;
      seenCats.set(key, rowNum);
      const status = STATUS_MAP[statusRaw] ?? "active";
      const existingRow = catByKey.get(key);
      const payload: any = { name, code: name, direction, sort_order: sort, status, remark: remark || "" };
      if (existingRow) out.categories.push({ sheet: "收支分类", rowNum, kind: "category", status: "update", data: { ...payload, __id: existingRow.id }, raw: r });
      else out.categories.push({ sheet: "收支分类", rowNum, kind: "category", status: "new", data: payload, raw: r });
    });
  }

  /* ========== Legacy Sheet1（个体户/店铺/账户） ========== */
  const legacyShop = findSheet(wb, "账户明细-个体户", "Sheet1", "sheet1");
  if (legacyShop && !sheetEntities && !sheetBanks && !sheetShops) {
    const rows = XLSX.utils.sheet_to_json<any>(legacyShop, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const shop = norm(r["店铺"]);
      const company = norm(r["公司"]);
      const bank = norm(r["银行"]);
      const accNoRaw = norm(r["账号"]);
      const accNo = normAcc(accNoRaw);
      const legal = norm(r["法人"]);
      if (!company && !shop && !accNo) return;

      if (company) {
        const k = `${normKey(company)}|individual`;
        if (!entityByNormName.has(k) && !seenEntities.has(k)) {
          seenEntities.set(k, rowNum);
          plannedEntities.set(normKey(company), { entity_type: "individual" });
          out.entities.push({
            sheet: "Sheet1", rowNum, kind: "entity", status: "new",
            data: { name: company, entity_type: "individual", legal_person: legal || null, annual_flow_limit: 5_000_000, status: "active" }, raw: r,
          });
        }
      }
      if (accNo) {
        // Default: needs user to confirm corporate/personal in preview
        const base: any = {
          account_holder_name: company || legal || "",
          account_type: ACCOUNT_TYPE_PENDING,
          bank_name: bank, account_number: accNoRaw, account_no_masked: accNoRaw,
          owner_entity_name: company || null,
          related_entity_name: company || null,
          related_person_name: legal || null,
          usage_type: "collection", is_default: true, current_balance: 0,
          status: "active", remark: "",
        };
        if (bankByAcc.has(accNo)) {
          out.banks.push({ sheet: "Sheet1", rowNum, kind: "bank", status: "update", data: { ...base, __id: bankByAcc.get(accNo).id }, raw: r, needsAccountType: true });
        } else if (seenBanks.has(accNo)) {
          out.banks.push({ sheet: "Sheet1", rowNum, kind: "bank", status: "skip", message: `文件内重复账号（第 ${seenBanks.get(accNo)} 行）`, data: {}, raw: r });
        } else {
          seenBanks.set(accNo, rowNum);
          out.banks.push({ sheet: "Sheet1", rowNum, kind: "bank", status: "new", data: base, raw: r, needsAccountType: true });
        }
      }
      if (shop) {
        const platform = platformByCode.get("douyin") ?? existing.platforms[0];
        if (platform) {
          const key = `${platform.id}|${normKey(shop)}`;
          if (!shopByKey.has(key) && !seenShops.has(key)) {
            seenShops.set(key, rowNum);
            out.shops.push({ sheet: "Sheet1", rowNum, kind: "shop", status: "new", data: { name: shop, platform_id: platform.id, platformName: platform.name, entityName: company, status: "active" }, raw: r });
          }
          // also create a binding row (collection) so legacy import wires shop↔account
          if (accNo) {
            const dedupKey = `${key}|${accNo}|collection`;
            if (!seenBindings.has(dedupKey)) {
              seenBindings.set(dedupKey, rowNum);
              out.bindings.push({
                sheet: "Sheet1", rowNum, kind: "binding", status: "new",
                data: { shopName: shop, platformName: platform.name, platform_id: platform.id, accountNo: accNoRaw, binding_type: "collection", is_default: true, effective_from: null, effective_to: null, status: "active", remark: "" },
                raw: r,
              });
            }
          }
        }
      }
    });
  }

  /* ========== Legacy Sheet2（运营公司/投流账户） ========== */
  const legacyOps = findSheet(wb, "账户明细-运营公司", "Sheet2", "sheet2");
  if (legacyOps && !sheetEntities && !sheetBanks) {
    const rows = XLSX.utils.sheet_to_json<any>(legacyOps, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const company = norm(r["运营单位（投流）"] ?? r["运营单位(投流)"] ?? r["公司"]);
      const bank = norm(r["银行"]);
      const accNoRaw = norm(r["账号"]);
      const accNo = normAcc(accNoRaw);
      const legal = norm(r["法人代表"] ?? r["法人"]);
      if (!company && !accNo) return;
      if (company) {
        const k = `${normKey(company)}|company`;
        if (!entityByNormName.has(k) && !seenEntities.has(k)) {
          seenEntities.set(k, rowNum);
          plannedEntities.set(normKey(company), { entity_type: "company" });
          out.entities.push({ sheet: "Sheet2", rowNum, kind: "entity", status: "new", data: { name: company, entity_type: "company", legal_person: legal || null, annual_flow_limit: 5_000_000, status: "active" }, raw: r });
        }
      }
      if (accNo) {
        const base: any = {
          account_holder_name: company || legal || "",
          account_type: ACCOUNT_TYPE_PENDING,
          bank_name: bank, account_number: accNoRaw, account_no_masked: accNoRaw,
          owner_entity_name: company || null,
          related_entity_name: company || null,
          related_person_name: legal || null,
          usage_type: "ads", is_default: false, current_balance: 0,
          status: "active", remark: "",
        };
        if (bankByAcc.has(accNo)) {
          out.banks.push({ sheet: "Sheet2", rowNum, kind: "bank", status: "update", data: { ...base, __id: bankByAcc.get(accNo).id }, raw: r, needsAccountType: true });
        } else if (seenBanks.has(accNo)) {
          out.banks.push({ sheet: "Sheet2", rowNum, kind: "bank", status: "skip", message: `文件内重复账号`, data: {}, raw: r });
        } else {
          seenBanks.set(accNo, rowNum);
          out.banks.push({ sheet: "Sheet2", rowNum, kind: "bank", status: "new", data: base, raw: r, needsAccountType: true });
        }
      }
    });
  }

  return out;
}

/* ========================== Templates / Exports ========================== */

export function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["主体名称*", "主体类型*", "主体简称", "法人 / 负责人", "年度流水额度", "状态", "备注"],
    ["杭州萧山独去闲贸易商行（个体工商户）", "个体户", "独去闲", "张三", 5000000, "启用", "示例"],
    ["示例运营公司", "运营公司", "示例运营", "李四", 5000000, "启用", "示例"],
  ]), "经营主体");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["开户名*", "账户类型*", "开户银行*", "银行账号*", "当前余额", "状态", "备注"],
    ["杭州萧山独去闲贸易商行", "对公账户", "中国银行某支行", "6222000000000000", 0, "启用", "对公账户开户名通常等于经营主体名称"],
    ["张三", "个人账户", "招商银行", "6222000000000001", 0, "启用", "个人账户开户名为持卡人"],
  ]), "银行账户");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["店铺名称*", "平台*", "经营主体*", "店铺状态", "备注"],
    ["莉娜kids DQ", "抖音", "杭州萧山独去闲贸易商行（个体工商户）", "运营中", ""],
  ]), "店铺");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["店铺名称*", "平台*", "银行账号*", "绑定类型*", "是否默认", "生效日期", "失效日期", "状态", "备注"],
    ["莉娜kids DQ", "抖音", "6222000000000000", "收款", "是", "2025-01-01", "", "启用", ""],
  ]), "店铺账户绑定");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["分类名称*", "收支方向*", "一级分类", "二级分类", "是否启用", "排序", "备注"],
    ["销售回款", "收入", "经营收入", "", "启用", 10, ""],
    ["供应商付款", "支出", "采购支出", "", "启用", 10, ""],
  ]), "收支分类");

  XLSX.writeFile(wb, `财务基础资料导入模板_${todayCN()}.xlsx`);
}

export function exportRowsToXlsx(filename: string, sheetName: string, rows: any[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), sheetName);
  XLSX.writeFile(wb, filename);
}

export function downloadErrorReport(errors: { sheet: string; rowNum: number; field?: string; message: string; raw?: any; result?: string }[]) {
  const rows = errors.map(e => ({
    Sheet: e.sheet, 行号: e.rowNum, 字段: e.field ?? "", 处理结果: e.result ?? "失败", 原因: e.message,
    原始数据: typeof e.raw === "object" ? JSON.stringify(e.raw) : String(e.raw ?? ""),
  }));
  exportRowsToXlsx(`导入错误报告_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`, "错误", rows);
}

export async function exportAllMasterData() {
  const fetchAll = async (table: string, cols: string) => {
    const out: any[] = []; let from = 0; const step = 1000;
    while (true) {
      const { data, error } = await supabase.from(table as any).select(cols).range(from, from + step - 1);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < step) break;
      from += step;
    }
    return out;
  };
  const [ents, banks, shops, bindings, cats, platforms] = await Promise.all([
    fetchAll("business_entities", "*"),
    fetchAll("bank_accounts", "*"),
    fetchAll("shops", "*"),
    fetchAll("shop_bank_account_bindings", "*"),
    fetchAll("cash_tx_categories", "*"),
    fetchAll("platforms", "id,name,code"),
  ]);
  const entMap = new Map(ents.map((e: any) => [e.id, e.name]));
  const bankMap = new Map(banks.map((b: any) => [b.id, b]));
  const shopMap = new Map(shops.map((s: any) => [s.id, s]));
  const platMap = new Map(platforms.map((p: any) => [p.id, p.name]));

  const entRows = ents.filter((e: any) => !e.deleted_at).map((e: any) => ({
    主体名称: e.name, 主体类型: ENTITY_TYPE_LABEL[e.entity_type] ?? e.entity_type,
    主体简称: e.code, 法人: e.legal_person, 年度流水额度: e.annual_flow_limit,
    状态: e.status === "active" ? "启用" : "停用", 备注: e.remark,
  }));
  const bindCountByBank = new Map<string, number>();
  bindings.forEach((b: any) => { if (b.status === "active") bindCountByBank.set(b.bank_account_id, (bindCountByBank.get(b.bank_account_id) ?? 0) + 1); });
  const bankRows = banks.filter((b: any) => !b.deleted_at).map((b: any) => ({
    开户名: b.account_holder_name || b.account_name,
    账户类型: ACCOUNT_TYPE_LABEL[b.account_type] ?? b.account_type,
    开户银行: b.bank_name, 银行账号: b.account_number || b.account_no_masked,
    绑定店铺数: bindCountByBank.get(b.id) ?? 0,
    当前余额: b.current_balance,
    状态: b.status === "active" ? "启用" : "停用", 备注: b.remark,
  }));
  const shopRows = shops.filter((s: any) => !s.deleted_at).map((s: any) => ({
    店铺名称: s.name, 平台: platMap.get(s.platform_id) ?? "",
    经营主体: entMap.get(s.entity_id) ?? "",
    店铺状态: s.status === "active" ? "运营中" : "停用", 备注: s.remark,
  }));
  const bindingRows = bindings.map((b: any) => {
    const sh = shopMap.get(b.shop_id); const bk = bankMap.get(b.bank_account_id);
    return {
      店铺名称: sh?.name ?? "", 平台: platMap.get(b.platform_id) ?? "",
      银行账号: bk?.account_number || bk?.account_no_masked || "",
      绑定类型: BINDING_TYPE_LABEL[b.binding_type] ?? b.binding_type,
      是否默认: b.is_default ? "是" : "否",
      生效日期: b.effective_from ?? "", 失效日期: b.effective_to ?? "",
      状态: b.status === "active" ? "启用" : "停用", 备注: b.remark,
    };
  });
  const catRows = cats.filter((c: any) => !c.deleted_at).map((c: any) => ({
    分类名称: c.name, 收支方向: c.direction === "in" ? "收入" : c.direction === "out" ? "支出" : "内部转账",
    排序: c.sort_order, 是否启用: c.status === "active" ? "启用" : "停用", 备注: c.remark,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entRows.length ? entRows : [{}]), "经营主体");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bankRows.length ? bankRows : [{}]), "银行账户");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopRows.length ? shopRows : [{}]), "店铺");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bindingRows.length ? bindingRows : [{}]), "店铺账户绑定");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows.length ? catRows : [{}]), "收支分类");
  XLSX.writeFile(wb, `财务基础资料_全量_${todayCN()}.xlsx`);
}
