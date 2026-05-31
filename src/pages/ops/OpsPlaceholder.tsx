import { PageHeader } from "@/components/ops/PageHeader";
import { EmptyTable } from "@/components/ops/EmptyTable";

interface OpsPlaceholderProps {
  breadcrumb: string[];
  title: string;
  description?: string;
  columns?: string[];
}

export default function OpsPlaceholder({ breadcrumb, title, description, columns }: OpsPlaceholderProps) {
  return (
    <div>
      <PageHeader breadcrumb={breadcrumb} title={title} description={description} />
      <EmptyTable columns={columns ?? ["编号", "名称", "状态", "更新时间", "操作"]} hint="该模块前端骨架已搭建，后续将接入业务数据" />
    </div>
  );
}
