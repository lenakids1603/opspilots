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
