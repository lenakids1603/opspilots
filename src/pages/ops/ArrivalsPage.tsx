import { PageHeader } from "@/components/ops/PageHeader";
import { EmptyTable } from "@/components/ops/EmptyTable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function ArrivalsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb={["仓库系统", "到货登记"]}
        title="仓库到货登记"
        description="记录供应商到货明细，与采购计划核对入库数量"
        actions={<Button size="sm"><Plus className="w-4 h-4 mr-1" /> 新建到货单</Button>}
      />
      <EmptyTable columns={["到货单号", "供应商", "到货日期", "应到 / 实到", "状态", "操作"]} />
    </div>
  );
}
