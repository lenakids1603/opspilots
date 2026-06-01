import * as XLSX from "xlsx";

export type RowStatus = "new" | "update" | "skip" | "error";

export interface PreviewRow {
  sheet: string;
  rowNum: number;
  status: RowStatus;
  message?: string;
  data: Record<string, any>;
  raw: Record<string, any>;
}

export interface ImportPreview {
  entities: PreviewRow[];
  banks: PreviewRow[];
  shops: PreviewRow[];
  categories: PreviewRow[];
}

export interface ExistingContext {
  entities: { id: string; name: string; code: string | null; legal_person: string | null; entity_type: string }[];
  banks: { id: string; entity_id: string; account_no_masked: string | null; bank_name: string | null }[];
  shops: { id: string; name: string; platform_id: string; entity_id: string }[];
  platforms: { id: string; name: string; code: string }[];
  categories: { id: string; direction: string; name: string }[];
}

const norm = (s: any) => (s == null ? "" : String(s).trim());
const normKey = (s: any) => norm(s).toLowerCase();
const normAcc = (s: any) => norm(s).replace(/\s+/g, "");
const toNum = (s: any): number | null => {
  if (s === "" || s == null) return null;
  const n = Number(String(s).replace(/[,，¥$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const ENTITY_TYPE_MAP: Record<string, string> = {
  个体户: "individual", 个体: "individual", 个体工商户: "individual",
  运营公司: "company", 公司: "company", 其他: "company", individual: "individual", company: "company",
};
const STATUS_MAP: Record<string, string> = {
  启用: "active", 运营中: "active", active: "active",
  停用: "disabled", 暂停: "disabled", 禁用: "disabled", disabled: "disabled",
};
const DIRECTION_MAP: Record<string, string> = {
  收入: "in", in: "in", 支出: "out", out: "out", 内部转账: "transfer", transfer: "transfer",
};
const YES_MAP = new Set(["是", "y", "yes", "true", "1"]);
const PURPOSE_VALID = new Set(["收款", "付款", "投流", "备用", "其他"]);

function findSheet(wb: XLSX.WorkBook, ...candidates: string[]): XLSX.WorkSheet | null {
  for (const c of candidates) {
    const found = wb.SheetNames.find(n => n === c || n.includes(c));
    if (found) return wb.Sheets[found];
  }
  return null;
}

export function parseAccountWorkbook(file: ArrayBuffer, existing: ExistingContext): ImportPreview {
  const wb = XLSX.read(file, { type: "array" });
  const out: ImportPreview = { entities: [], banks: [], shops: [], categories: [] };

  // Existing-DB lookups (normalized)
  const entityByNormName = new Map<string, any>();
  const entityByCode = new Map<string, any>();
  existing.entities.forEach(e => {
    entityByNormName.set(`${normKey(e.name)}|${e.entity_type}`, e);
    if (e.code && norm(e.code)) entityByCode.set(normKey(e.code), e);
  });
  const bankByAcc = new Map<string, any>();
  existing.banks.forEach(b => { if (b.account_no_masked) bankByAcc.set(normAcc(b.account_no_masked), b); });
  const platformByName = new Map(existing.platforms.map(p => [normKey(p.name), p]));
  const platformByCode = new Map(existing.platforms.map(p => [normKey(p.code), p]));
  const shopByKey = new Map(existing.shops.map(s => [`${s.platform_id}|${normKey(s.name)}`, s]));
  const catByKey = new Map(existing.categories.map(c => [`${c.direction}|${normKey(c.name)}`, c]));

  // In-file dedup trackers
  const seenEntities = new Map<string, number>(); // key -> first row number
  const seenBanks = new Map<string, number>();
  const seenShops = new Map<string, number>();
  const seenCats = new Map<string, number>();
  const plannedEntities = new Map<string, { entity_type: string }>(); // norm name (no type) -> info

  const resolvePlatform = (v: string) => platformByName.get(normKey(v)) ?? platformByCode.get(normKey(v)) ?? null;
  const resolveEntityName = (v: string, fallbackType = "individual") => {
    const k = normKey(v);
    for (const t of ["individual", "company"]) {
      const hit = entityByNormName.get(`${k}|${t}`);
      if (hit) return hit.name;
    }
    if (entityByCode.has(k)) return entityByCode.get(k)!.name;
    if (plannedEntities.has(k)) return v; // raw name as planned
    return "";
  };

  /* ========== 经营主体 ========== */
  const sheetEntities = findSheet(wb, "经营主体");
  if (sheetEntities) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetEntities, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const name = norm(r["主体名称*"] ?? r["主体名称"] ?? r["名称"]);
      const code = norm(r["主体简称/编码"] ?? r["编码"] ?? r["主体编码"]);
      const typeRaw = norm(r["主体类型*(个体户/运营公司/其他)"] ?? r["主体类型"] ?? r["类型"]);
      const legal = norm(r["法人"] ?? r["法人代表"]);
      const limit = toNum(r["年度流水额度"]);
      const statusRaw = norm(r["状态(启用/停用)"] ?? r["状态"]);
      const remark = norm(r["备注"]);

      if (!name) { out.entities.push({ sheet: "经营主体", rowNum, status: "error", message: "主体名称必填", data: {}, raw: r }); return; }
      if (typeRaw && !ENTITY_TYPE_MAP[typeRaw]) {
        out.entities.push({ sheet: "经营主体", rowNum, status: "error", message: `主体类型无效: ${typeRaw}`, data: {}, raw: r }); return;
      }
      const entity_type = ENTITY_TYPE_MAP[typeRaw] ?? "individual";
      const status = STATUS_MAP[statusRaw] ?? "active";

      // in-file dedup
      const key = `${normKey(name)}|${entity_type}`;
      if (seenEntities.has(key)) {
        out.entities.push({ sheet: "经营主体", rowNum, status: "skip", message: `文件内重复（已在第 ${seenEntities.get(key)} 行出现），已跳过`, data: {}, raw: r });
        return;
      }
      seenEntities.set(key, rowNum);

      const existingRow = entityByNormName.get(key) ?? (code ? entityByCode.get(normKey(code)) : undefined);
      const payload: any = {
        name, code: code || null, entity_type, legal_person: legal || null,
        annual_flow_limit: limit ?? 5_000_000, status, remark: remark || "",
      };
      if (existingRow) {
        out.entities.push({ sheet: "经营主体", rowNum, status: "update", data: { ...payload, __id: existingRow.id }, raw: r });
      } else {
        plannedEntities.set(normKey(name), { entity_type });
        out.entities.push({ sheet: "经营主体", rowNum, status: "new", data: payload, raw: r });
      }
    });
  }

  /* ========== 银行账户 ========== */
  const sheetBanks = findSheet(wb, "银行账户");
  if (sheetBanks) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetBanks, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const entityName = norm(r["所属主体*"] ?? r["所属主体"] ?? r["经营主体"] ?? r["主体名称"]);
      const bank = norm(r["开户银行*"] ?? r["开户银行"] ?? r["银行"]);
      const accNoRaw = norm(r["银行账号*"] ?? r["银行账号"] ?? r["账号"]);
      const accNo = normAcc(accNoRaw);
      const purposeRaw = norm(r["账户用途(收款/付款/投流/备用/其他)"] ?? r["账户用途"] ?? r["用途"]) || "收款";
      const isDefault = YES_MAP.has(norm(r["是否默认账户(是/否)"] ?? r["是否默认账户"] ?? r["默认"]).toLowerCase());
      const balance = toNum(r["当前余额"]) ?? 0;
      const statusRaw = norm(r["状态(启用/停用)"] ?? r["状态"]);
      const remark = norm(r["备注"]);

      if (!entityName) return out.banks.push({ sheet: "银行账户", rowNum, status: "error", message: "所属主体必填", data: {}, raw: r }) && void 0;
      if (!bank) return out.banks.push({ sheet: "银行账户", rowNum, status: "error", message: "开户银行必填", data: {}, raw: r }) && void 0;
      if (!accNo) return out.banks.push({ sheet: "银行账户", rowNum, status: "error", message: "银行账号必填", data: {}, raw: r }) && void 0;
      if (purposeRaw && !PURPOSE_VALID.has(purposeRaw)) {
        out.banks.push({ sheet: "银行账户", rowNum, status: "error", message: `账户用途无效: ${purposeRaw}`, data: {}, raw: r }); return;
      }
      const resolved = resolveEntityName(entityName);
      if (!resolved) {
        out.banks.push({ sheet: "银行账户", rowNum, status: "error", message: `找不到经营主体【${entityName}】（请先在经营主体 Sheet 中定义）`, data: {}, raw: r }); return;
      }

      if (seenBanks.has(accNo)) {
        out.banks.push({ sheet: "银行账户", rowNum, status: "skip", message: `文件内重复账号（已在第 ${seenBanks.get(accNo)} 行出现），已跳过`, data: {}, raw: r });
        return;
      }
      seenBanks.set(accNo, rowNum);

      const status = STATUS_MAP[statusRaw] ?? "active";
      const existingRow = bankByAcc.get(accNo);
      const payload: any = {
        entityName: resolved, account_name: resolved, bank_name: bank,
        account_no_masked: accNoRaw, purpose: purposeRaw, is_default: isDefault,
        current_balance: balance, status, remark: remark || "",
      };
      if (existingRow) {
        out.banks.push({ sheet: "银行账户", rowNum, status: "update", data: { ...payload, __id: existingRow.id }, raw: r });
      } else {
        out.banks.push({ sheet: "银行账户", rowNum, status: "new", data: payload, raw: r });
      }
    });
  }

  /* ========== 店铺 ========== */
  const sheetShops = findSheet(wb, "店铺");
  if (sheetShops) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetShops, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const shopName = norm(r["店铺名称*"] ?? r["店铺名称"] ?? r["店铺"] ?? r["名称"]);
      const platformRaw = norm(r["平台*(抖音/淘宝/天猫/快手/小红书/其他)"] ?? r["平台"]);
      const entityName = norm(r["所属主体*"] ?? r["所属主体"] ?? r["公司"] ?? r["经营主体"]);
      const defaultAccRaw = norm(r["默认收款银行账号"] ?? r["默认银行账号"]);
      const defaultAcc = normAcc(defaultAccRaw);
      const statusRaw = norm(r["店铺状态(运营中/暂停/停用)"] ?? r["状态"]);
      const remark = norm(r["备注"]);

      if (!shopName) return out.shops.push({ sheet: "店铺", rowNum, status: "error", message: "店铺名称必填", data: {}, raw: r }) && void 0;
      if (!platformRaw) return out.shops.push({ sheet: "店铺", rowNum, status: "error", message: "平台必填", data: {}, raw: r }) && void 0;
      const platform = resolvePlatform(platformRaw);
      if (!platform) return out.shops.push({ sheet: "店铺", rowNum, status: "error", message: `平台无效: ${platformRaw}`, data: {}, raw: r }) && void 0;
      if (!entityName) return out.shops.push({ sheet: "店铺", rowNum, status: "error", message: "所属主体必填", data: {}, raw: r }) && void 0;
      const resolved = resolveEntityName(entityName);
      if (!resolved) return out.shops.push({ sheet: "店铺", rowNum, status: "error", message: `找不到经营主体【${entityName}】`, data: {}, raw: r }) && void 0;
      if (defaultAcc && !bankByAcc.has(defaultAcc) && !seenBanks.has(defaultAcc)) {
        out.shops.push({ sheet: "店铺", rowNum, status: "error", message: `找不到默认银行账号【${defaultAccRaw}】`, data: {}, raw: r }); return;
      }

      const key = `${platform.id}|${normKey(shopName)}`;
      if (seenShops.has(key)) {
        out.shops.push({ sheet: "店铺", rowNum, status: "skip", message: `文件内重复（已在第 ${seenShops.get(key)} 行出现），已跳过`, data: {}, raw: r });
        return;
      }
      seenShops.set(key, rowNum);

      const status = STATUS_MAP[statusRaw] ?? "active";
      const existingRow = shopByKey.get(key);
      const payload: any = {
        name: shopName, platform_id: platform.id, platformName: platform.name,
        entityName: resolved, defaultAccountNo: defaultAcc || "", status, remark: remark || "",
      };
      if (existingRow) {
        out.shops.push({ sheet: "店铺", rowNum, status: "update", data: { ...payload, __id: existingRow.id }, raw: r });
      } else {
        out.shops.push({ sheet: "店铺", rowNum, status: "new", data: payload, raw: r });
      }
    });
  }

  /* ========== 收支分类 ========== */
  const sheetCats = findSheet(wb, "收支分类");
  if (sheetCats) {
    const rows = XLSX.utils.sheet_to_json<any>(sheetCats, { defval: "", raw: false });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const name = norm(r["分类名称*"] ?? r["分类名称"] ?? r["名称"]);
      const dirRaw = norm(r["收支方向*(收入/支出)"] ?? r["收支方向"] ?? r["方向"]);
      const sort = toNum(r["排序"]) ?? 100;
      const statusRaw = norm(r["状态(启用/停用)"] ?? r["状态"]);
      const remark = norm(r["备注"]);

      if (!name) return out.categories.push({ sheet: "收支分类", rowNum, status: "error", message: "分类名称必填", data: {}, raw: r }) && void 0;
      const direction = DIRECTION_MAP[dirRaw];
      if (!direction) return out.categories.push({ sheet: "收支分类", rowNum, status: "error", message: `收支方向无效: ${dirRaw || "(空)"}`, data: {}, raw: r }) && void 0;

      const key = `${direction}|${normKey(name)}`;
      if (seenCats.has(key)) {
        out.categories.push({ sheet: "收支分类", rowNum, status: "skip", message: `文件内重复（已在第 ${seenCats.get(key)} 行出现），已跳过`, data: {}, raw: r });
        return;
      }
      seenCats.set(key, rowNum);

      const status = STATUS_MAP[statusRaw] ?? "active";
      const existingRow = catByKey.get(key);
      const payload: any = { name, code: name, direction, sort_order: sort, status, remark: remark || "" };
      if (existingRow) {
        out.categories.push({ sheet: "收支分类", rowNum, status: "update", data: { ...payload, __id: existingRow.id }, raw: r });
      } else {
        out.categories.push({ sheet: "收支分类", rowNum, status: "new", data: payload, raw: r });
      }
    });
  }

  /* ========== Legacy Sheet1/Sheet2 (账户明细) ========== */
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
          out.entities.push({
            sheet: "Sheet1", rowNum, status: "new",
            data: { name: company, entity_type: "individual", legal_person: legal || null, annual_flow_limit: 5_000_000, status: "active" }, raw: r,
          });
        }
      }
      if (accNo) {
        if (bankByAcc.has(accNo)) {
          out.banks.push({ sheet: "Sheet1", rowNum, status: "update", data: { __id: bankByAcc.get(accNo).id, entityName: company, account_name: company, bank_name: bank, account_no_masked: accNoRaw, purpose: "收款", is_default: true, current_balance: 0, status: "active" }, raw: r });
        } else if (seenBanks.has(accNo)) {
          out.banks.push({ sheet: "Sheet1", rowNum, status: "skip", message: `文件内重复账号（已在第 ${seenBanks.get(accNo)} 行出现）`, data: {}, raw: r });
        } else {
          seenBanks.set(accNo, rowNum);
          out.banks.push({ sheet: "Sheet1", rowNum, status: "new", data: { entityName: company, account_name: company, bank_name: bank, account_no_masked: accNoRaw, purpose: "收款", is_default: true, current_balance: 0, status: "active" }, raw: r });
        }
      }
      if (shop) {
        const platform = platformByCode.get("douyin") ?? existing.platforms[0];
        if (platform) {
          const key = `${platform.id}|${normKey(shop)}`;
          if (!shopByKey.has(key) && !seenShops.has(key)) {
            seenShops.set(key, rowNum);
            out.shops.push({ sheet: "Sheet1", rowNum, status: "new", data: { name: shop, platform_id: platform.id, platformName: platform.name, entityName: company, defaultAccountNo: accNo, status: "active" }, raw: r });
          }
        }
      }
    });
  }
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
          out.entities.push({ sheet: "Sheet2", rowNum, status: "new", data: { name: company, entity_type: "company", legal_person: legal || null, annual_flow_limit: 5_000_000, status: "active" }, raw: r });
        }
      }
      if (accNo) {
        if (bankByAcc.has(accNo)) {
          out.banks.push({ sheet: "Sheet2", rowNum, status: "update", data: { __id: bankByAcc.get(accNo).id, entityName: company, account_name: company, bank_name: bank, account_no_masked: accNoRaw, purpose: "投流", is_default: false, current_balance: 0, status: "active" }, raw: r });
        } else if (seenBanks.has(accNo)) {
          out.banks.push({ sheet: "Sheet2", rowNum, status: "skip", message: `文件内重复账号`, data: {}, raw: r });
        } else {
          seenBanks.set(accNo, rowNum);
          out.banks.push({ sheet: "Sheet2", rowNum, status: "new", data: { entityName: company, account_name: company, bank_name: bank, account_no_masked: accNoRaw, purpose: "投流", is_default: false, current_balance: 0, status: "active" }, raw: r });
        }
      }
    });
  }

  return out;
}

export function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["主体名称*", "主体简称/编码", "主体类型*(个体户/运营公司/其他)", "法人", "年度流水额度", "状态(启用/停用)", "备注"],
    ["杭州示例服装经营部", "DEMO", "个体户", "张三", 5000000, "启用", "示例"],
  ]), "经营主体");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["所属主体*", "开户银行*", "银行账号*", "账户用途(收款/付款/投流/备用/其他)", "是否默认账户(是/否)", "当前余额", "状态(启用/停用)", "备注"],
    ["杭州示例服装经营部", "中国银行某支行", "6222000000000000", "收款", "是", 0, "启用", ""],
  ]), "银行账户");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["店铺名称*", "平台*(抖音/淘宝/天猫/快手/小红书/其他)", "所属主体*", "默认收款银行账号", "店铺状态(运营中/暂停/停用)", "备注"],
    ["莉娜kids 示例", "抖音", "杭州示例服装经营部", "6222000000000000", "运营中", ""],
  ]), "店铺");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["分类名称*", "收支方向*(收入/支出)", "排序", "状态(启用/停用)", "备注"],
    ["销售回款", "收入", 10, "启用", ""],
    ["供应商付款", "支出", 10, "启用", ""],
  ]), "收支分类");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["店铺", "公司", "银行", "账号", "法人"],
    ["示例店铺", "示例经营主体", "示例银行", "6222000000000000", "张三"],
  ]), "账户明细-个体户");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["运营单位（投流）", "银行", "账号", "法人代表"],
    ["示例运营公司", "示例银行", "6222000000000001", "李四"],
  ]), "账户明细-运营公司");
  XLSX.writeFile(wb, `财务基础资料模板_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
