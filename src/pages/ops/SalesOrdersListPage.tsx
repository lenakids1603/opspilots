import { PageHeader } from "@/components/ops/PageHeader";
import { SalesOrdersRecentPreview } from "@/components/ops/SalesOrdersRecentPreview";

export default function SalesOrdersListPage() {
  return (
    <div>
      <PageHeader
        breadcrumb={["运维系统", "订单列表"]}
        title="订单列表"
        description="聚水潭同步的销售订单（最近 50 条，按修改时间倒序，15 秒自动刷新）"
      />
      <SalesOrdersRecentPreview />
    </div>
  );
}
