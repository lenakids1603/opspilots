import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2, Plug } from "lucide-react";

type CheckResult = {
  ok: boolean;
  present?: Record<string, boolean>;
  checked_at?: string;
  duration_ms?: number;
  sample_shop_count?: number;
  message?: string;
  error?: string;
  hint?: string;
};

const REQUIRED = ["JST_APP_KEY", "JST_APP_SECRET"];
const OPTIONAL = ["JST_ACCESS_TOKEN", "JST_REFRESH_TOKEN", "JST_PROXY_URL"];

export function JstConnectionCheckCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("jst-sync-dispatch", {
        body: { action: "connection_test" },
      });
      if (error) {
        setResult({ ok: false, error: error.message });
        toast.error("连接检测失败");
      } else {
        setResult(data as CheckResult);
        if ((data as CheckResult).ok) toast.success("聚水潭连接正常");
        else toast.error("聚水潭连接异常");
      }
    } catch (e: any) {
      setResult({ ok: false, error: String(e?.message ?? e) });
    } finally {
      setLoading(false);
    }
  };

  const present = result?.present ?? {};
  const missingRequired = REQUIRED.filter((k) => result && !present[k]);
  const credsMissing = !result ? false : missingRequired.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" /> 聚水潭连接检测
        </CardTitle>
        <Button size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          立即检测
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!result && (
          <p className="text-muted-foreground">
            点击「立即检测」验证 Edge Function 是否已配置聚水潭凭证、Access Token 是否有效、能否成功请求聚水潭轻量接口。
          </p>
        )}

        {credsMissing && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>聚水潭 API 凭证未配置</AlertTitle>
            <AlertDescription>
              当前只能使用页面结构和同步日志，无法拉取真实聚水潭数据。请在 Supabase Edge Function Secrets 中配置：
              <span className="font-mono"> {missingRequired.join(", ")}</span>
            </AlertDescription>
          </Alert>
        )}

        {result && !credsMissing && !result.ok && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>接口请求失败</AlertTitle>
            <AlertDescription>
              <div className="break-all">{result.error}</div>
              {result.hint && <div className="mt-1 text-xs opacity-80">{result.hint}</div>}
            </AlertDescription>
          </Alert>
        )}

        {result?.ok && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>连接正常</AlertTitle>
            <AlertDescription>
              {result.message}（耗时 {result.duration_ms ?? 0}ms，样本店铺数 {result.sample_shop_count ?? 0}）
            </AlertDescription>
          </Alert>
        )}

        {result && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">凭证配置状态</div>
            <div className="flex flex-wrap gap-2">
              {[...REQUIRED, ...OPTIONAL].map((k) => {
                const has = !!present[k];
                const required = REQUIRED.includes(k);
                return (
                  <Badge key={k} variant={has ? "default" : required ? "destructive" : "secondary"}>
                    {k}: {has ? "已配置" : required ? "缺失" : "未配置"}
                  </Badge>
                );
              })}
            </div>
            {result.checked_at && (
              <div className="text-xs text-muted-foreground mt-2">
                最近检测时间：{new Date(result.checked_at).toLocaleString("zh-CN")}
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t pt-2">
          <div className="font-medium mb-1">需要配置的 Edge Function Secrets：</div>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><span className="font-mono">JST_APP_KEY</span>（必填）— 聚水潭开放平台 app key</li>
            <li><span className="font-mono">JST_APP_SECRET</span>（必填）— 聚水潭开放平台 app secret</li>
            <li><span className="font-mono">JST_ACCESS_TOKEN</span>（首次必填其一）— 初始 access token 种子</li>
            <li><span className="font-mono">JST_REFRESH_TOKEN</span>（首次必填其一）— 初始 refresh token 种子，用于自动刷新</li>
            <li><span className="font-mono">JST_PROXY_URL</span>（可选）— HTTP 代理，用于 IP 白名单出口</li>
            <li><span className="font-mono">JST_PROXY_USER</span> / <span className="font-mono">JST_PROXY_PASS</span>（可选）— 代理认证</li>
          </ul>
          <div className="mt-1">所有凭证只保存在 Edge Function Secrets，不在前端、不在仓库、不暴露给浏览器。前端只调用 jst-sync-dispatch。</div>
        </div>
      </CardContent>
    </Card>
  );
}
