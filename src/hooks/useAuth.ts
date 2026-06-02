import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import type { AppRole, Profile } from '@/lib/types';

type SignInAudience = 'internal' | 'supplier';

const supplierEmailOf = (username: string) => `${username.trim().toLowerCase()}@supplier.local`;

function normalizeLoginError(error: any) {
  const message = String(error?.message ?? '登录失败');
  const code = String(error?.code ?? '').toLowerCase();
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return '账号邮箱尚未确认，请联系管理员重新启用或重置密码';
  }
  if (code === 'user_banned' || /banned/i.test(message)) {
    return '账号已停用，请联系管理员启用后再登录';
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return '账号或密码不正确，请确认已选择正确登录身份，并使用管理员最新设置的密码';
  }
  return message;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);

  const fetchProfileAndRoles = useCallback(async (userId: string) => {
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('user_roles').select('*').eq('user_id', userId),
    ]);
    if (profileRes.data) setProfile(profileRes.data as unknown as Profile);
    if (rolesRes.data) setRoles((rolesRes.data as unknown as { role: AppRole }[]).map(r => r.role));
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchProfileAndRoles(session.user.id), 0);
        } else {
          setProfile(null);
          setRoles([]);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfileAndRoles(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfileAndRoles]);

  const signIn = async (identifier: string, password: string, audience: SignInAudience = 'internal') => {
    const rawIdentifier = identifier.trim();
    const lookupIdentifier = audience === 'supplier' ? rawIdentifier.toLowerCase() : rawIdentifier;
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    console.info('[auth.signIn] start', {
      identifier: rawIdentifier,
      loginType: audience,
      supabaseUrl,
      projectId,
    });

    if (!rawIdentifier) {
      return { error: { message: '请输入账号' } as { message: string } };
    }

    let email = lookupIdentifier;
    let rpcEmail: string | null = null;
    let rpcErrorMessage: string | null = null;

    if (!lookupIdentifier.includes('@')) {
      const { data, error: rpcError } = await supabase.rpc('get_email_by_identifier', { _identifier: lookupIdentifier });
      rpcEmail = (data as string | null) ?? null;
      rpcErrorMessage = rpcError?.message ?? null;

      if (rpcError) {
        console.warn('[auth.signIn] identifier lookup failed', {
          identifier: rawIdentifier,
          loginType: audience,
          rpcEmail,
          finalEmail: null,
          supabaseError: rpcErrorMessage,
          supabaseUrl,
          projectId,
        });
        return { error: { message: '账号映射查询失败：' + rpcError.message } as { message: string } };
      }

      if (rpcEmail) {
        email = rpcEmail;
      } else if (audience === 'supplier') {
        email = supplierEmailOf(lookupIdentifier);
      } else {
        console.warn('[auth.signIn] identifier not found', {
          identifier: rawIdentifier,
          loginType: audience,
          rpcEmail,
          finalEmail: null,
          supabaseUrl,
          projectId,
        });
        return { error: { message: '账号不存在或无法识别' } as { message: string } };
      }
    }

    const finalEmail = email.toLowerCase();
    console.info('[auth.signIn] resolved', {
      identifier: rawIdentifier,
      loginType: audience,
      rpcEmail,
      finalEmail,
      supabaseUrl,
      projectId,
    });

    const { error } = await supabase.auth.signInWithPassword({ email: finalEmail, password });
    if (error) {
      console.warn('[auth.signIn] failed', {
        identifier: rawIdentifier,
        loginType: audience,
        rpcEmail,
        finalEmail,
        supabaseError: {
          name: error.name,
          message: error.message,
          status: (error as any).status,
          code: (error as any).code,
        },
        supabaseUrl,
        projectId,
      });
      return { error: { message: normalizeLoginError(error) } as { message: string } };
    }

    return { error: null };
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    department: string,
    extras?: { username?: string; phone?: string; user_type?: 'internal' | 'supplier' },
  ) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          department,
          username: extras?.username,
          phone: extras?.phone,
          user_type: extras?.user_type ?? 'internal',
        },
        emailRedirectTo: window.location.origin,
      },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const hasRole = (role: AppRole) => roles.includes(role);

  return { user, session, loading, profile, roles, hasRole, signIn, signUp, signOut };
}
