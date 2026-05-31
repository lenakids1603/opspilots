import { PageHeader } from "@/components/ops/PageHeader";
import { EmptyTable } from "@/components/ops/EmptyTable";
import { Button } from "@/components/ui/button";
import { Plus, Download } from "lucide-react";

export default function SuppliersPage() {
  return (
    <div>
      <PageHeader
        breadcrumb={["供应商系统", "供应商档案"]}
        title="供应商档案"
        description="维护供应商基础信息、联系人与启停状态"
        actions={
          <>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" /> 导出</Button>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" /> 新建供应商</Button>
          </>
        }
      />
      <EmptyTable
        columns={["供应商编号", "名称", "联系人", "电话", "状态", "操作"]}
        hint='点击右上角"新建供应商"开始录入'
      />
    </div>
  );
}
