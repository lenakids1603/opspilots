import { PageHeader } from "@/components/ops/PageHeader";
import { EmptyTable } from "@/components/ops/EmptyTable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function SupplierBillsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb={["财税系统", "供应商账单核对"]}
        title="供应商账单核对"
        description="按账期核对供应商应付金额，标记审核 / 异议 / 已付状态"
        actions={<Button size="sm"><Plus className="w-4 h-4 mr-1" /> 新建账单</Button>}
      />
      <EmptyTable columns={["账单号", "供应商", "账期", "金额", "状态", "操作"]} />
    </div>
  );
}
