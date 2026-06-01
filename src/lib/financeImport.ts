import * as XLSX from "xlsx";

export type RowStatus = "new" | "update" | "skip" | "error";
export interface PreviewRow {
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

const norm = (s: any) => (s == null ? "" : String(s).trim());

/** Parse 账户明细.xlsx-style file: Sheet1 = stores (店铺/公司/银行/账号/法人), Sheet2 = ops cos (运营单位/银行/账号/法人代表).
 *  Also accepts the unified template with sheet names: 经营主体/银行账户/店铺/收支分类. */
export function parseAccountWorkbook(
  file: ArrayBuffer,
  existing: {
    entities: { id: string; name: string; legal_person: string | null; entity_type: string }[];
    banks: { id: string; entity_id: string; account_no_masked: string | null; bank_name: string | null }[];
    shops: { id: string; name: string; platform_id: string }[];
    platforms: { id: string; name: string; code: string }[];
    categories: { id: string; direction: string; parent_id: string | null; name: string }[];
  },
): ImportPreview {
  const wb = XLSX.read(file, { type: "array" });
  const out: ImportPreview = { entities: [], banks: [], shops: [], categories: [] };

  const entityByName = new Map(existing.entities.map(e => [norm(e.name), e]));
  const plannedEntities = new Map<string, { name: string; legal_person: string; entity_type: string }>();
  const bankKey = (eName: string, no: string) => `${eName}|${no}`;
  const seenBanks = new Set(
    existing.banks.map(b => {
      const e = existing.entities.find(x => x.id === b.entity_id);
      return bankKey(norm(e?.name), norm(b.account_no_masked));
    }),
  );
  const shopByKey = new Set(existing.shops.map(s => `${norm(s.name)}|${s.platform_id}`));

  const handleEntityRow = (name: string, legal: string, type: "individual" | "company") => {
    if (!name) return;
    if (entityByName.has(name) || plannedEntities.has(name)) {
      // update legal_person if changed (optional)
      const existing = entityByName.get(name);
      if (existing) {
        out.entities.push({
          status: "skip",
          message: "主体已存在",
          data: { name, legal_person: legal, entity_type: type },
          raw: { name, legal_person: legal, entity_type: type },
        });
      }
      return;
    }
    plannedEntities.set(name, { name, legal_person: legal, entity_type: type });
    out.entities.push({
      status: "new",
      data: { name, legal_person: legal, entity_type: type, annual_flow_limit: 5_000_000, status: "active" },
      raw: { name, legal_person: legal, entity_type: type },
    });
  };

  const handleBankRow = (entityName: string, bankName: string, accNo: string, purpose: string) => {
    if (!entityName || !accNo) {
      out.banks.push({
        status: "error",
        message: !entityName ? "缺少经营主体" : "缺少银行账号",
        data: {},
        raw: { entityName, bankName, accNo },
      });
      return;
    }
    const k = bankKey(entityName, accNo);
    if (seenBanks.has(k)) {
      out.banks.push({ status: "skip", message: "账号已存在", data: { entityName, bankName, accNo }, raw: { entityName, bankName, accNo } });
      return;
    }
    seenBanks.add(k);
    out.banks.push({
      status: "new",
      data: { entityName, account_name: entityName, bank_name: bankName, account_no_masked: accNo, purpose, status: "active" },
      raw: { entityName, bankName, accNo, purpose },
    });
  };

  // Sheet1: 店铺/公司/银行/账号/法人
  const sheet1 = wb.Sheets[wb.SheetNames.find(n => n.toLowerCase().includes("sheet1")) || wb.SheetNames[0]];
  if (sheet1) {
    const rows = XLSX.utils.sheet_to_json<any>(sheet1, { defval: "", raw: false });
    for (const r of rows) {
      const shop = norm(r["店铺"] ?? r["店铺名称"]);
      const company = norm(r["公司"] ?? r["经营主体"]);
      const bank = norm(r["银行"] ?? r["开户银行"]);
      const accNo = norm(r["账号"] ?? r["银行账号"]);
      const legal = norm(r["法人"] ?? r["法人代表"]);
      if (!company && !shop && !bank && !accNo) continue;
      handleEntityRow(company, legal, "individual");
      handleBankRow(company, bank, accNo, "收款");
      if (shop) {
        // default platform: 抖音
        const platform = existing.platforms.find(p => p.code === "douyin") || existing.platforms[0];
        const k = `${shop}|${platform?.id ?? ""}`;
        if (shopByKey.has(k)) {
          out.shops.push({ status: "skip", message: "店铺已存在", data: { name: shop, company }, raw: r });
        } else {
          shopByKey.add(k);
          out.shops.push({
            status: "new",
            data: { name: shop, company, platform_id: platform?.id, platform_name: platform?.name, status: "active" },
            raw: r,
          });
        }
      }
    }
  }

  // Sheet2: 运营单位（投流）/银行/账号/法人代表
  const sheet2Idx = wb.SheetNames.find(n => n.toLowerCase().includes("sheet2"));
  if (sheet2Idx) {
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheet2Idx], { defval: "", raw: false });
    for (const r of rows) {
      const company = norm(r["运营单位（投流）"] ?? r["运营单位(投流)"] ?? r["公司"] ?? r["经营主体"]);
      const bank = norm(r["银行"] ?? r["开户银行"]);
      const accNo = norm(r["账号"] ?? r["银行账号"]);
      const legal = norm(r["法人代表"] ?? r["法人"]);
      if (!company && !bank && !accNo) continue;
      handleEntityRow(company, legal, "company");
      handleBankRow(company, bank, accNo, "投流");
    }
  }

  // Optional: also handle a "收支分类" sheet
  const catSheet = wb.SheetNames.find(n => n.includes("收支分类"));
  if (catSheet) {
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[catSheet], { defval: "", raw: false });
    for (const r of rows) {
      const name = norm(r["分类名称"] ?? r["名称"]);
      const dir = norm(r["收支方向"] ?? r["方向"]);
      const directionVal = dir.includes("收") ? "in" : dir.includes("支") ? "out" : "out";
      if (!name) continue;
      const dup = existing.categories.find(c => c.direction === directionVal && c.name === name);
      out.categories.push({
        status: dup ? "skip" : "new",
        message: dup ? "分类已存在" : undefined,
        data: { name, direction: directionVal, code: name, sort_order: 100, status: "active" },
        raw: r,
      });
    }
  }

  return out;
}

export function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const beHeader = [
    ["主体名称*", "主体简称/编码", "主体类型*(个体户/运营公司/其他)", "法人", "年度流水额度", "状态(启用/停用)", "备注"],
    ["杭州示例服装经营部", "DEMO", "个体户", "张三", 5000000, "启用", "示例"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(beHeader), "经营主体");

  const baHeader = [
    ["所属主体*", "开户银行*", "银行账号*", "账户用途(收款/付款/投流/备用/其他)", "是否默认账户(是/否)", "当前余额", "状态(启用/停用)", "备注"],
    ["杭州示例服装经营部", "中国银行某支行", "6222000000000000", "收款", "是", 0, "启用", ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(baHeader), "银行账户");

  const shHeader = [
    ["店铺名称*", "平台*(抖音/淘宝/天猫/快手/小红书/其他)", "所属主体*", "默认收款银行账号", "店铺状态(运营中/暂停/停用)", "备注"],
    ["莉娜kids 示例", "抖音", "杭州示例服装经营部", "6222000000000000", "运营中", ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shHeader), "店铺");

  const ctHeader = [
    ["分类名称*", "收支方向*(收入/支出)", "上级分类", "排序", "状态(启用/停用)", "备注"],
    ["销售回款", "收入", "", 10, "启用", ""],
    ["供应商付款", "支出", "", 10, "启用", ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ctHeader), "收支分类");

  // Account-detail style template
  const ad1 = [["店铺", "公司", "银行", "账号", "法人"], ["示例店铺", "示例经营主体", "示例银行", "6222000000000000", "张三"]];
  const ad2 = [["运营单位（投流）", "银行", "账号", "法人代表"], ["示例运营公司", "示例银行", "6222000000000001", "李四"]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ad1), "账户明细-个体户");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ad2), "账户明细-运营公司");

  XLSX.writeFile(wb, `财务基础资料模板_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportRowsToXlsx(filename: string, sheetName: string, rows: any[]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
