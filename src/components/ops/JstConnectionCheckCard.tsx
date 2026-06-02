import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, Plug, Search } from "lucide-react";

type CheckResult = {
  ok: boolean;
  status?: "success" | "warning" | "error";
  present?: Record<string, boolean>;
  checked_at?: string;
  duration_ms?: number;
  sample_shop_count?: number;
  message?: string;
  error?: string;
  hint?: string;
  diagnostics?: Record<string, unknown>;
  sanitized_response?: unknown;
  transport_failed?: boolean;
};


const REQUIRED = ["JST_APP_KEY", "JST_APP_SECRET"];
const OPTIONAL = ["JST_ACCESS_TOKEN", "JST_REFRESH_TOKEN", "JST_PROXY_URL", "JST_PROXY_USER", "JST_PROXY_PASS"];

export function JstConnectionCheckCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const qc = useQueryClient();

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("jst-sync-dispatch", {
        body: { action: "connection_test" },
      });
      if (error) {
        // Edge Function 调用本身失败（登录态失效 / 网络 / 函数崩溃），
        // 此时不会有 present 字段，绝不能据此判断凭证是否缺失。
        setResult({ ok: false, error: error.message, transport_failed: true } as CheckResult);
        toast.error("无法调用 Edge Function（通常是登录态失效，请重新登录后再试）");
      } else {
        setResult(data as CheckResult);
        const res = data as CheckResult;
        if (res.status === "success") toast.success("聚水潭连接正常");
        else if (res.status === "warning") toast.warning("连接可达，但未获取到店铺数据");
        else toast.error("聚水潭连接异常");
        qc.invalidateQueries({ queryKey: ["jst_sync_runs"] });
        qc.invalidateQueries({ queryKey: ["jst_sync_errors"] });
      }
    } catch (e: any) {
      setResult({ ok: false, error: String(e?.message ?? e), transport_failed: true } as CheckResult);
    } finally {
      setLoading(false);
    }
  };

  const hasPresent = !!result?.present;
  const present = result?.present ?? {};
  const missingRequired = hasPresent ? REQUIRED.filter((k) => !present[k]) : [];
  const credsMissing = hasPresent && missingRequired.length > 0;
  const transportFailed = !!(result as any)?.transport_failed;
  const isWarning = result?.status === "warning" || (!!result && !result.ok && hasPresent && !credsMissing && result.sample_shop_count === 0);

  const diagnosticsPayload = result?.diagnostics
    ? { diagnostics: result.diagnostics, sanitized_response: result.sanitized_response }
    : null;

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

        {transportFailed && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>无法连接 Edge Function</AlertTitle>
            <AlertDescription>
              <div className="break-all">{result?.error}</div>
              <div className="mt-1 text-xs opacity-80">
                请求未到达 jst-sync-dispatch（常见原因：登录态过期、网络中断）。请重新登录后再点击检测。
                这种情况下无法判断 Edge Function Secrets 是否配置，请勿据此认为凭证缺失。
              </div>
            </AlertDescription>
          </Alert>
        )}

        {result && !transportFailed && !credsMissing && !result.ok && !isWarning && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>接口请求失败</AlertTitle>
            <AlertDescription>
              <div className="break-all">{result.error}</div>
              {result.hint && <div className="mt-1 text-xs opacity-80">{result.hint}</div>}
            </AlertDescription>
          </Alert>
        )}

        {result && !transportFailed && !credsMissing && isWarning && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>连接可达，但未获取到店铺数据</AlertTitle>
            <AlertDescription>
              <div className="break-all">{result.error ?? result.message ?? "shops/query 返回空列表"}</div>
              {result.hint && <div className="mt-1 text-xs opacity-80">{result.hint}</div>}
            </AlertDescription>
          </Alert>
        )}

        {result?.status === "success" && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>连接正常</AlertTitle>
            <AlertDescription>
              {result.message}（耗时 {result.duration_ms ?? 0}ms，样本店铺数 {result.sample_shop_count ?? 0}）
            </AlertDescription>
          </Alert>
        )}

        {hasPresent && (

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-xs text-muted-foreground">凭证配置状态</div>
              {diagnosticsPayload && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      <Search className="h-3 w-3 mr-1" /> 查看脱敏响应
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>聚水潭连接检测脱敏响应</DialogTitle>
                      <DialogDescription>
                        仅展示接口路径、参数摘要、响应字段与样本结构；token、secret、代理密码等敏感字段已脱敏。
                      </DialogDescription>
                    </DialogHeader>
                    <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap break-all">
                      {JSON.stringify(diagnosticsPayload, null, 2)}
                    </pre>
                  </DialogContent>
                </Dialog>
              )}
            </div>
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
