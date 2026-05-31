import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

type Props = {
  children: React.ReactNode;
  /** 'internal' = only company members, 'supplier' = only supplier accounts, undefined = any */
  audience?: 'internal' | 'supplier';
};

export default function ProtectedRoute({ children, audience }: Props) {
  const { user, loading, profile } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Wait for profile so we can route correctly
  if (audience && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (audience === 'internal' && profile?.user_type === 'supplier') {
    return <Navigate to="/supplier" replace />;
  }
  if (audience === 'supplier' && profile?.user_type !== 'supplier') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
