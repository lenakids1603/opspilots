import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import {
  Bot,
  Building2,
  Truck,
  Mail,
  Lock,
  ArrowRight,
  BarChart3,
  Wrench,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import type { UserType } from '@/lib/types';

const features = [
  { icon: BarChart3, title: '经营数据分析后台', desc: '统一查看费用、预算与趋势' },
  { icon: Wrench, title: '部门辅助工具', desc: '提交、审批、报销一站式' },
  { icon: Sparkles, title: '自动化减负系统', desc: 'AI 助手帮你处理重复工作' },
];

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [userType, setUserType] = useState<UserType>('internal');
  const [isLoading, setIsLoading] = useState(false);
  const { user, loading, profile, signIn } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const routeFor = (type?: string | null) => (type === 'supplier' ? '/supplier' : '/');

  useEffect(() => {
    if (!loading && user && profile) {
      navigate(routeFor(profile.user_type), { replace: true });
    }
  }, [user, loading, profile, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await signIn(identifier, password, userType);
    setIsLoading(false);
    if (error) {
      toast({ title: '登录失败', description: error.message, variant: 'destructive' });
    }
    // navigation handled by useEffect once profile loads
  };

  const fillTest = (id: string) => {
    setIdentifier(id);
    setPassword(id);
    setUserType(id === 'gys' ? 'supplier' : 'internal');
  };

  return (
    <main className="flex min-h-screen">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 text-white overflow-hidden bg-[hsl(220_60%_10%)]">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(circle at 20% 20%, hsl(221 83% 30% / 0.6), transparent 60%), radial-gradient(circle at 80% 80%, hsl(199 89% 28% / 0.5), transparent 55%)',
          }}
        />
        <div className="relative">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/20">
            <Bot className="lucide lucide-receipt h-6 w-6 text-base" />
          </div>
        </div>

        <div className="relative space-y-10">
          <div>
            <h1 className="text-5xl font-bold tracking-tight leading-tight whitespace-pre-line">
              Lenakids OpsPilots{"\n"}经营数据与自动化中心
            </h1>
            <p className="mt-3 text-white/70 text-base">
              Business Insights &amp; Automation Hub
            </p>
          </div>

          <ul className="space-y-3 max-w-sm">
            {features.map((f) => (
              <li
                key={f.title}
                className="flex items-start gap-3 rounded-lg bg-white/5 backdrop-blur px-4 py-3 ring-1 ring-white/10"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/10">
                  <f.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-xs text-white/60">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-white/50">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>© {new Date().getFullYear()} Lenakids · 企业内部协同管理系统</span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-background px-4 sm:px-8 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight">欢迎回来</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              请选择身份并登录您的企业账户
            </p>
          </div>

          {/* Custom segmented tabs */}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1 mb-6">
            <button
              type="button"
              onClick={() => setUserType('internal')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                userType === 'internal'
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Building2 className="h-4 w-4" /> 企业成员登录
            </button>
            <button
              type="button"
              onClick={() => setUserType('supplier')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                userType === 'supplier'
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Truck className="h-4 w-4" /> 供应商用户登录
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="identifier">手机号 / 邮箱 / 用户名</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="identifier"
                  placeholder="请输入手机号、邮箱或用户名"
                  className="pl-10 min-h-[44px]"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">密码</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() =>
                    toast({ title: '请联系管理员', description: '当前演示环境暂未开通找回密码' })
                  }
                >
                  忘记密码?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10 min-h-[44px]"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(v) => setRemember(!!v)}
              />
              <Label htmlFor="remember" className="text-sm font-normal cursor-pointer">
                记住登录状态
              </Label>
            </div>

            <Button
              type="submit"
              className="w-full min-h-[48px] text-base gap-2"
              disabled={isLoading}
            >
              {isLoading ? '登录中...' : '登录系统'}
              {!isLoading && <ArrowRight className="h-4 w-4" />}
            </Button>


            <p className="text-center text-xs text-muted-foreground">
              登录即表示同意我们的{' '}
              <a className="text-foreground hover:underline" href="#">服务条款</a> 与{' '}
              <a className="text-foreground hover:underline" href="#">隐私政策</a>。还没有账号？{' '}
              <Link to="/signup" className="text-primary hover:underline">立即注册</Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
