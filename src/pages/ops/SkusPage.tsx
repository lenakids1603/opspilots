import { PageHeader } from "@/components/ops/PageHeader";
import { EmptyTable } from "@/components/ops/EmptyTable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function SkusPage() {
  return (
    <div>
      <PageHeader
        breadcrumb={["商品系统", "SKU 管理"]}
        title="SKU 管理"
        description="管理商品的规格、条码、成本与售价"
        actions={<Button size="sm"><Plus className="w-4 h-4 mr-1" /> 新建 SKU</Button>}
      />
      <EmptyTable columns={["SKU 编号", "商品", "规格", "条码", "成本价", "售价", "库存", "操作"]} />
    </div>
  );
}
