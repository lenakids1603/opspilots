export type AppRole = 'employee' | 'manager' | 'finance';
export type UserType = 'internal' | 'supplier';

export interface Profile {
  id: string;
  full_name: string;
  department: string;
  manager_id: string | null;
  username: string | null;
  phone: string | null;
  user_type: UserType;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

// ===== Legacy expense template stubs (dead code, retained for type compatibility) =====
export type ExpenseStatus = string;
export interface ExpenseCategory {
  id: string;
  name: string;
  [k: string]: any;
}
export interface Expense {
  id: string;
  user_id: string;
  category_id?: string | null;
  amount: number;
  status: ExpenseStatus;
  created_at: string;
  updated_at: string;
  [k: string]: any;
}
export interface ApprovalAction {
  id: string;
  expense_id: string;
  action: string;
  created_at: string;
  [k: string]: any;
}
export interface AuditLog {
  id: string;
  action: string;
  created_at: string;
  [k: string]: any;
}
export const STATUS_CONFIG: Record<string, { label: string; color: string; className?: string; variant?: any }> = new Proxy(
  {} as any,
  {
    get: () => ({ label: '-', color: 'gray', className: '', variant: 'secondary' }),
  },
);
