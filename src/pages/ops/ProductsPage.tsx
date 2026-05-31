import { PageHeader } from "@/components/ops/PageHeader";
import { EmptyTable } from "@/components/ops/EmptyTable";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function ProductsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb={["商品系统", "商品档案"]}
        title="商品档案"
        description="管理商品基础信息、类目和所属供应商"
        actions={<Button size="sm"><Plus className="w-4 h-4 mr-1" /> 新建商品</Button>}
      />
      <EmptyTable columns={["商品编号", "名称", "类目", "品牌", "供应商", "状态", "操作"]} />
    </div>
  );
}
