interface PageHeaderProps {
  breadcrumb: string[];
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ breadcrumb, title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6">
      <div className="text-xs text-muted-foreground mb-2">
        {breadcrumb.map((b, i) => (
          <span key={i}>
            {i > 0 && <span className="mx-1.5 text-muted-foreground/50">/</span>}
            <span className={i === breadcrumb.length - 1 ? "text-foreground font-medium" : ""}>{b}</span>
          </span>
        ))}
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}
