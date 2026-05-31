import { PageHeader } from "@/components/ops/PageHeader";
import { EmptyTable } from "@/components/ops/EmptyTable";

type Props = { title: string; description: string; columns: string[] };

export default function SupplierPlaceholder({ title, description, columns }: Props) {
  return (
    <div>
      <PageHeader breadcrumb={["供应商门户", title]} title={title} description={description} />
      <EmptyTable columns={columns} />
    </div>
  );
}
