// Shared 断点续跑 job engine (windowed pagination) for JST sync edge functions.
// Reuses jst_sync_jobs + jst_sync_logs schema. Supports backend auto-continue
// via self-invocation, atomic per-job locks, cancellation cooperatively.
import { admin } from "./jst-client.ts";

export type JobSyncType = string;

export interface JobConfig {
  maxWindowDays: number;
  pageSize: number;
  maxPagesPerRun: number;
  timeBudgetSeconds: number;
  staleMs: number;
  /** If a window's pageIndex exceeds this AND there are still more pages, proactively split the rest of the window. */
  proactiveSplitAfterPage?: number;
}

export const DEFAULT_JOB_CONFIG: JobConfig = {
  maxWindowDays: 3,
  pageSize: 50,
  maxPagesPerRun: 3,
  timeBudgetSeconds: 45,
  staleMs: 2 * 60_000,
  proactiveSplitAfterPage: 0,
};

export interface PageResult {
  apiCount: number;
  mainUpserted: number;
  itemUpserted: number;
  failed: number;
  hasNext: boolean;
  errorDetail?: string;
  requestBody?: any;
  responseCode?: string | null;
  responseMsg?: string | null;
  durationMs?: number;
}

export interface ProcessPageArgs {
  job: any;
  windowIndex: number;
  windowFrom: Date;
  windowTo: Date;
  pageIndex: number;
  pageSize: number;
}

export type ProcessPageFn = (args: ProcessPageArgs) => Promise<PageResult>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export function buildJobWindows(from: Date, to: Date, maxDays: number) {
  const stepMs = Math.max(60_000, maxDays * 86400_000 - 60_000);
  const out: Array<{ from: string; to: string }> = [];
  let cur = from.getTime();
  const end = to.getTime();
  if (end <= cur) {
    out.push({ from: new Date(cur).toISOString(), to: new Date(cur + 60_000).toISOString() });
    return out;
  }
  while (cur < end) {
    const next = Math.min(cur + stepMs, end);
    out.push({ from: new Date(cur).toISOString(), to: new Date(next).toISOString() });
    cur = next;
  }
  return out;
}

export async function markStaleJobs(syncType: JobSyncType, staleMs: number) {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const { data } = await admin
    .from("jst_sync_jobs")
    .update({
      status: "stalled",
      ended_at: null,
      message: "任务超过 2 分钟无心跳，已标记为 stalled，可点击「继续同步」从断点恢复",
      error_detail: "stalled: heartbeat exceeded threshold",
    })
    .eq("sync_type", syncType)
    .in("status", ["running", "pending"])
    .lt("heartbeat_at", cutoff)
    .select("id");
  return data?.length ?? 0;
}

async function findActiveJob(syncType: JobSyncType) {
  const { data } = await admin
    .from("jst_sync_jobs")
    .select("*")
    .eq("sync_type", syncType)
    .in("status", ["pending", "running", "partial", "waiting_next_tick", "stalled"])
    .eq("cancel_requested", false)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function createJob(opts: {
  syncType: JobSyncType;
  fromIso: string;
  toIso: string;
  triggerType: string;
  requestedRange: string;
  createdBy: string | null;
  config?: Partial<JobConfig>;
  parentLogMessagePrefix?: string;
}) {
  const config = { ...DEFAULT_JOB_CONFIG, ...(opts.config ?? {}) };
  await markStaleJobs(opts.syncType, config.staleMs);
  const existing = await findActiveJob(opts.syncType);
  if (existing) return { ...existing, _reused: true };
  const windows = buildJobWindows(new Date(opts.fromIso), new Date(opts.toIso), config.maxWindowDays);

  const { data: log, error: logErr } = await admin.from("jst_sync_logs").insert({
    sync_type: opts.syncType,
    status: "running",
    cursor_from: opts.fromIso,
    cursor_to: opts.toIso,
    heartbeat_at: new Date().toISOString(),
    message: `${opts.parentLogMessagePrefix ?? "[断点同步]"} 范围=${opts.fromIso} → ${opts.toIso}; 拆分=${windows.length} 段 (≤${config.maxWindowDays}天/段); 每次最多 ${config.maxPagesPerRun} 页 / ${config.timeBudgetSeconds}s`,
  }).select("id").single();
  if (logErr) throw logErr;

  const { data: job, error: jobErr } = await admin.from("jst_sync_jobs").insert({
    parent_log_id: log.id,
    sync_type: opts.syncType,
    status: "pending",
    trigger_type: opts.triggerType,
    requested_range: opts.requestedRange,
    requested_from: opts.fromIso,
    requested_to: opts.toIso,
    total_windows: windows.length,
    current_window_index: 0,
    current_window_from: windows[0]?.from ?? null,
    current_window_to: windows[0]?.to ?? null,
    current_page_index: 0,
    next_page_index: 1,
    page_size: config.pageSize,
    has_next: true,
    max_window_days: config.maxWindowDays,
    max_pages_per_run: config.maxPagesPerRun,
    time_budget_seconds: config.timeBudgetSeconds,
    windows,
    created_by: opts.createdBy,
    heartbeat_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    auto_continue: true,
    cancel_requested: false,
    message: "任务已创建，等待第一次 tick",
  }).select().single();
  if (jobErr) throw jobErr;
  await admin.from("jst_sync_logs").update({ job_id: job.id }).eq("id", log.id);
  return job;
}

/** updateJob – never overwrites a cancelled job back to running/partial/success. */
async function updateJob(jobId: string, patch: Record<string, unknown>) {
  const { data: cur } = await admin
    .from("jst_sync_jobs")
    .select("status, cancel_requested")
    .eq("id", jobId)
    .maybeSingle();
  if (cur?.status === "cancelled" || cur?.cancel_requested === true) {
    // Only allow updating heartbeat / message / error_detail on cancelled jobs
    const safe: Record<string, unknown> = { heartbeat_at: new Date().toISOString() };
    if (typeof patch.message === "string") safe.message = patch.message;
    if (typeof patch.error_detail === "string") safe.error_detail = patch.error_detail;
    if (Object.keys(safe).length === 0) return;
    await admin.from("jst_sync_jobs").update(safe).eq("id", jobId);
    return;
  }
  await admin.from("jst_sync_jobs").update({
    ...patch,
    heartbeat_at: new Date().toISOString(),
  }).eq("id", jobId);
}

export async function cancelJob(jobId: string) {
  const { data: existing } = await admin
    .from("jst_sync_jobs")
    .select("id, parent_log_id, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, cancelled: false, job_id: jobId, error: "任务不存在", updated_job_count: 0, updated_log_count: 0 };
  }
  const nowIso = new Date().toISOString();
  const { data: jobUpd } = await admin.from("jst_sync_jobs").update({
    status: "cancelled",
    has_next: false,
    auto_continue: false,
    cancel_requested: true,
    cancelled_at: nowIso,
    ended_at: nowIso,
    heartbeat_at: nowIso,
    locked_until: null,
    message: "用户手动终止",
    error_detail: "用户手动终止",
  }).eq("id", jobId).select("id");
  let updatedLogCount = 0;
  if (existing.parent_log_id) {
    const { data: logUpd } = await admin.from("jst_sync_logs").update({
      status: "cancelled",
      ended_at: nowIso,
      error_detail: "用户手动终止",
    }).eq("id", existing.parent_log_id).select("id");
    updatedLogCount = logUpd?.length ?? 0;
  }
  return {
    ok: true,
    cancelled: true,
    job_id: jobId,
    updated_job_count: jobUpd?.length ?? 0,
    updated_log_count: updatedLogCount,
  };
}

function isTransientError(err: any): boolean {
  if (!err) return false;
  if (err.transient === true) return true;
  if (err.aborted === true) return true;
  const code = String(err.code ?? "");
  if (code === "ABORTED" || code === "429" || /^5\d\d$/.test(code)) return true;
  const msg = String(err.message ?? err.apiMsg ?? "");
  if (/请求超时|timeout|timed out|AbortError|aborted|network|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|HTTP 5\d\d|HTTP 429|限流|频率/i.test(msg)) {
    return true;
  }
  return false;
}

function classifyErrorType(err: any): string {
  if (err?.errorType) return String(err.errorType);
  const msg = String(err?.message ?? "");
  if (/超时|timeout|AbortError|aborted/i.test(msg)) return "timeout";
  if (/HTTP 5\d\d/.test(msg)) return "http_5xx";
  if (/HTTP 429|限流|rate/i.test(msg)) return "rate_limited";
  if (/network|fetch failed|ECONN|ETIMEDOUT|socket/i.test(msg)) return "network";
  const code = String(err?.code ?? "");
  if (code === "130") return "param_error";
  if (code === "190") return "permission";
  return "unknown";
}

function splitWindow(win: { from: string; to: string }, parts = 2): Array<{ from: string; to: string }> {
  const a = new Date(win.from).getTime();
  const b = new Date(win.to).getTime();
  if (!(b > a) || parts < 2) return [win];
  const step = Math.max(60_000, Math.floor((b - a) / parts));
  const out: Array<{ from: string; to: string }> = [];
  let cur = a;
  for (let i = 0; i < parts; i++) {
    const next = i === parts - 1 ? b : Math.min(cur + step, b);
    out.push({ from: new Date(cur).toISOString(), to: new Date(next).toISOString() });
    cur = next;
    if (cur >= b) break;
  }
  return out;
}

const MAX_RETRY_BEFORE_SPLIT = 2;
const MAX_SPLIT_TIMES = 4;

/** Returns true if the job should still continue (not cancelled). */
async function checkNotCancelled(jobId: string): Promise<boolean> {
  const { data } = await admin
    .from("jst_sync_jobs")
    .select("status, cancel_requested")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return false;
  if (data.status === "cancelled") return false;
  if (data.cancel_requested === true) return false;
  return true;
}

export async function tickJob(jobId: string, processPage: ProcessPageFn, config: Partial<JobConfig> = {}, lockOwner?: string) {
  const cfg = { ...DEFAULT_JOB_CONFIG, ...config };
  const owner = lockOwner ?? `tick-${crypto.randomUUID()}`;
  const tickStart = Date.now();

  // Atomic lock acquire
  const { data: locked, error: lockErr } = await admin.rpc("jst_try_lock_job", {
    _job_id: jobId, _owner: owner, _ttl_seconds: Math.max(60, cfg.timeBudgetSeconds + 30),
  });
  if (lockErr) throw lockErr;
  if (!locked) {
    const { data: cur } = await admin.from("jst_sync_jobs").select("status, cancel_requested").eq("id", jobId).maybeSingle();
    return { status: "locked", locked: true, job: cur };
  }

  try {
    const { data: job, error: loadErr } = await admin.from("jst_sync_jobs").select("*").eq("id", jobId).maybeSingle();
    if (loadErr) throw loadErr;
    if (!job) throw new Error("任务不存在");
    if (job.cancel_requested === true || job.status === "cancelled") {
      return { status: "cancelled", job };
    }
    if (job.status === "success") return { status: "success", job };

    let windows: Array<{ from: string; to: string }> = Array.isArray(job.windows) ? job.windows : [];
    if (windows.length === 0) {
      await updateJob(jobId, { status: "success", ended_at: new Date().toISOString(), message: "范围为空，无需同步" });
      return { status: "success", job };
    }

    await updateJob(jobId, {
      status: "running",
      ended_at: null,
      message: `开始处理，当前窗口 ${(job.current_window_index ?? 0) + 1}/${windows.length}`,
    });

    const budgetMs = (job.time_budget_seconds ?? cfg.timeBudgetSeconds) * 1000;
    const maxPages = job.max_pages_per_run ?? cfg.maxPagesPerRun;
    const pageSize = job.page_size ?? cfg.pageSize;
    const proactiveSplitAfterPage = cfg.proactiveSplitAfterPage ?? 0;

    let metadata: Record<string, any> = (job.metadata && typeof job.metadata === "object") ? { ...job.metadata } : {};
    let windowIndex = job.current_window_index ?? 0;
    let pageIndex = job.next_page_index || 1;
    let totalApi = job.total_api_count ?? 0;
    let totalMain = job.total_order_upserted ?? 0;
    let totalItem = job.total_item_upserted ?? 0;
    let totalFailed = job.total_failed ?? 0;
    let pagesThisRun = 0;
    let lastError = "";
    let transientPause = false;
    let transientMessage = "";
    let consecutiveTransient: number = Number(metadata.consecutive_transient ?? 0);

    while (windowIndex < windows.length) {
      if (Date.now() - tickStart > budgetMs) break;
      if (pagesThisRun >= maxPages) break;
      if (Date.now() - tickStart > Math.max(0, budgetMs - 10_000)) {
        transientPause = true;
        transientMessage = `剩余预算不足，已暂停 · 当前窗口 ${windowIndex + 1}/${windows.length} 下一页=${pageIndex}`;
        break;
      }
      // Cooperative cancel check before each page
      if (!(await checkNotCancelled(jobId))) {
        return { status: "cancelled", job: { ...job, status: "cancelled" } };
      }
      const win = windows[windowIndex];
      const winFrom = new Date(win.from);
      const winTo = new Date(win.to);
      const pageStart = Date.now();
      try {
        const result = await processPage({ job: { ...job, metadata }, windowIndex, windowFrom: winFrom, windowTo: winTo, pageIndex, pageSize });
        pagesThisRun++;
        totalApi += result.apiCount;
        totalMain += result.mainUpserted;
        totalItem += result.itemUpserted;
        totalFailed += result.failed;
        consecutiveTransient = 0;
        metadata.consecutive_transient = 0;
        if (result.failed > 0 && result.errorDetail) lastError = result.errorDetail.slice(0, 500);
        if (metadata.retry && metadata.retry.windowIndex === windowIndex && metadata.retry.pageIndex === pageIndex) {
          delete metadata.retry;
        }

        // Proactive split: if we are deep into pagination and there's still more, split remaining window.
        let movedNext = !result.hasNext || result.apiCount === 0;
        let proactiveSplitInfo = "";
        if (!movedNext && proactiveSplitAfterPage > 0 && pageIndex >= proactiveSplitAfterPage) {
          const splitCount = metadata.split_count ?? 0;
          if (splitCount < MAX_SPLIT_TIMES) {
            // Split the CURRENT window in 2: keep "processed" half as done conceptually,
            // restart from page 1 on the remaining half.
            const sub = splitWindow(windows[windowIndex], 2);
            if (sub.length > 1) {
              windows = [...windows.slice(0, windowIndex), ...sub, ...windows.slice(windowIndex + 1)];
              metadata.split_count = splitCount + 1;
              metadata.last_split_at = new Date().toISOString();
              metadata.last_split_reason = `proactive_after_page_${pageIndex}`;
              pageIndex = 1;
              movedNext = true; // we will jump to the next (newly inserted) sub-window
              proactiveSplitInfo = ` · 第 ${pageIndex} 页后主动拆分窗口为 ${sub.length} 段`;
            }
          }
        }

        const newWindowIndex = movedNext ? windowIndex + 1 : windowIndex;
        const newPageIndex = movedNext ? 1 : pageIndex + 1;
        const moreAfter = !(movedNext && newWindowIndex >= windows.length);
        const shouldPause = moreAfter && (pagesThisRun >= maxPages || Date.now() - tickStart > Math.max(0, budgetMs - 5000));

        try {
          await admin.from("jst_sync_log_details").insert({
            job_id: job.id, log_id: job.parent_log_id, sync_type: job.sync_type,
            window_index: windowIndex, window_from: win.from, window_to: win.to,
            page_index: pageIndex, page_size: pageSize,
            api_count: result.apiCount, has_next: result.hasNext,
            main_upserted: result.mainUpserted, item_upserted: result.itemUpserted,
            failed_count: result.failed,
            request_body: result.requestBody ?? null,
            response_code: result.responseCode ?? null,
            response_msg: result.responseMsg ?? null,
            duration_ms: result.durationMs ?? (Date.now() - pageStart),
            error_detail: result.errorDetail ?? null,
          });
        } catch (_e) { /* ignore */ }

        const pageErrSuffix = result.failed > 0 && result.errorDetail ? ` · 末次错误: ${result.errorDetail.slice(0, 200)}` : "";
        const patch: Record<string, unknown> = {
          status: moreAfter ? (shouldPause ? "partial" : "running") : (totalFailed > 0 ? "partial" : "success"),
          ended_at: moreAfter ? null : new Date().toISOString(),
          current_window_index: newWindowIndex,
          current_window_from: windows[newWindowIndex]?.from ?? win.from,
          current_window_to: windows[newWindowIndex]?.to ?? win.to,
          current_page_index: pageIndex,
          next_page_index: newPageIndex,
          has_next: moreAfter,
          total_api_count: totalApi,
          total_order_upserted: totalMain,
          total_item_upserted: totalItem,
          total_failed: totalFailed,
          total_windows: windows.length,
          windows,
          metadata,
          last_success_at: new Date().toISOString(),
          message: `窗口 ${windowIndex + 1}/${windows.length} 第 ${pageIndex} 页完成 (本页 ${result.apiCount} 条，主表+${result.mainUpserted}，明细+${result.itemUpserted}，失败 ${result.failed}${result.hasNext ? "，还有下一页" : "，本窗口结束"})${pageErrSuffix}${proactiveSplitInfo}`,
        };
        if (lastError) patch.error_detail = lastError;
        await updateJob(jobId, patch);
        windowIndex = newWindowIndex;
        pageIndex = newPageIndex;
        if (shouldPause) break;
      } catch (err: any) {
        const errMsg = String((err as Error).message ?? err).slice(0, 1500);
        const transient = isTransientError(err);
        const errType = classifyErrorType(err);
        const durationMs = err?.durationMs ?? (Date.now() - pageStart);

        try {
          await admin.from("jst_sync_log_details").insert({
            job_id: job.id, log_id: job.parent_log_id, sync_type: job.sync_type,
            window_index: windowIndex, window_from: win.from, window_to: win.to,
            page_index: pageIndex, page_size: pageSize,
            api_count: 0, has_next: transient, main_upserted: 0, item_upserted: 0,
            failed_count: 1, duration_ms: durationMs,
            request_body: err?.requestBody ?? null,
            response_code: err?.responseCode ?? (err?.code != null ? String(err.code) : null),
            response_msg: err?.responseMsg ?? err?.apiMsg ?? null,
            error_detail: errMsg,
            error_type: errType,
          });
        } catch (_e) { /* ignore */ }

        if (transient) {
          consecutiveTransient++;
          metadata.consecutive_transient = consecutiveTransient;
          const retry = (metadata.retry && metadata.retry.windowIndex === windowIndex && metadata.retry.pageIndex === pageIndex)
            ? { ...metadata.retry, count: (metadata.retry.count ?? 0) + 1 }
            : { windowIndex, pageIndex, count: 1 };
          metadata.retry = retry;
          metadata.last_error_type = errType;
          metadata.last_failed_window_index = windowIndex;
          metadata.last_failed_page_index = pageIndex;

          let splitInfo = "";
          if (retry.count >= MAX_RETRY_BEFORE_SPLIT) {
            const splitCount = (metadata.split_count ?? 0);
            if (splitCount < MAX_SPLIT_TIMES) {
              const sub = splitWindow(windows[windowIndex], 2);
              if (sub.length > 1) {
                windows = [...windows.slice(0, windowIndex), ...sub, ...windows.slice(windowIndex + 1)];
                metadata.split_count = splitCount + 1;
                metadata.last_split_at = new Date().toISOString();
                metadata.last_split_reason = `retry_after_${errType}`;
                delete metadata.retry;
                pageIndex = 1;
                splitInfo = ` · 已自动拆分窗口为 ${sub.length} 段，从第 1 段第 1 页重试`;
              }
            } else {
              splitInfo = ` · 已达最大拆分次数(${MAX_SPLIT_TIMES})`;
            }
          }

          transientPause = true;
          transientMessage = `临时${errType === "timeout" ? "超时" : "错误"}（${errType}），等待重试 · 窗口 ${windowIndex + 1}/${windows.length} 第 ${pageIndex} 页${splitInfo} · ${errMsg.slice(0, 200)}`;
          lastError = errMsg;
          await updateJob(jobId, {
            status: "waiting_next_tick",
            ended_at: null,
            has_next: true,
            current_window_index: windowIndex,
            current_window_from: windows[windowIndex]?.from ?? win.from,
            current_window_to: windows[windowIndex]?.to ?? win.to,
            next_page_index: pageIndex,
            total_api_count: totalApi,
            total_order_upserted: totalMain,
            total_item_upserted: totalItem,
            total_failed: totalFailed,
            total_windows: windows.length,
            windows,
            metadata,
            error_detail: errMsg,
            message: transientMessage,
          });
          break;
        }

        lastError = errMsg;
        totalFailed++;
        metadata.last_error_type = errType;
        await updateJob(jobId, {
          total_failed: totalFailed,
          metadata,
          error_detail: errMsg,
          message: `窗口 ${windowIndex + 1}/${windows.length} 第 ${pageIndex} 页失败(${errType}): ${errMsg}`,
        });
        break;
      }
    }

    const allDone = windowIndex >= windows.length;

    if (transientPause) {
      const msg = `已同步 ${totalMain} 单 / ${totalItem} 明细 · ${transientMessage}`;
      await admin.from("jst_sync_logs").update({
        status: "running",
        ended_at: null,
        fetched_orders_count: totalMain,
        fetched_items_count: totalItem,
        heartbeat_at: new Date().toISOString(),
        message: msg,
        error_detail: lastError || "",
      }).eq("id", job.parent_log_id);
      return { status: "waiting_next_tick", job: { ...job, status: "waiting_next_tick", metadata, windows, consecutive_transient: consecutiveTransient } };
    }

    const finalJobStatus = allDone
      ? (lastError && totalMain === 0 && totalItem === 0 ? "failed" : "success")
      : (lastError ? "failed" : "partial");
    const parentLogStatus = allDone
      ? (totalFailed > 0 ? "partial_failed" : "success")
      : (lastError ? "failed" : "running");

    const tail: Record<string, unknown> = {
      status: finalJobStatus,
      ended_at: allDone || lastError ? new Date().toISOString() : null,
      total_api_count: totalApi,
      total_order_upserted: totalMain,
      total_item_upserted: totalItem,
      total_failed: totalFailed,
      total_windows: windows.length,
      current_window_index: Math.min(windowIndex, windows.length - 1),
      current_window_from: windows[Math.min(windowIndex, windows.length - 1)]?.from ?? null,
      current_window_to: windows[Math.min(windowIndex, windows.length - 1)]?.to ?? null,
      next_page_index: pageIndex,
      error_detail: lastError || "",
      windows,
      metadata,
      message: allDone
        ? `全部完成 · 窗口 ${windows.length} 个 · 主表 ${totalMain} · 明细 ${totalItem} · 失败 ${totalFailed}${lastError ? ` · 末次错误: ${lastError}` : ""}`
        : (lastError
          ? `任务失败 · 窗口 ${windowIndex + 1}/${windows.length} 第 ${pageIndex} 页 · ${lastError}`
          : `本次 tick 已处理 ${pagesThisRun} 页，等待继续 · 当前窗口 ${windowIndex + 1}/${windows.length} 下一页=${pageIndex}`),
    };
    await updateJob(jobId, tail);

    await admin.from("jst_sync_logs").update({
      status: parentLogStatus,
      ended_at: tail.ended_at,
      fetched_orders_count: totalMain,
      fetched_items_count: totalItem,
      heartbeat_at: new Date().toISOString(),
      message: tail.message,
      error_detail: lastError || "",
    }).eq("id", job.parent_log_id);

    return { status: finalJobStatus, job: { ...job, ...tail } };
  } finally {
    try { await admin.rpc("jst_release_job_lock", { _job_id: jobId, _owner: owner }); } catch (_e) { /* ignore */ }
  }
}

function backoffMs(consecutiveTransient: number): number {
  // 15s -> 30s -> 60s -> 120s
  const ladder = [15_000, 30_000, 60_000, 120_000];
  if (consecutiveTransient <= 1) return ladder[0];
  if (consecutiveTransient === 2) return ladder[1];
  if (consecutiveTransient === 3) return ladder[2];
  return ladder[3];
}

/** Schedule a self-invocation of this edge function to drive the next tick. */
async function scheduleNextTick(functionName: string, tickActionName: string, jobId: string, delayMs: number) {
  try {
    // Stamp next_tick_at so the UI can show a countdown
    await admin.from("jst_sync_jobs").update({
      next_tick_at: new Date(Date.now() + delayMs).toISOString(),
    }).eq("id", jobId);
  } catch (_e) { /* ignore */ }
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
  const body = JSON.stringify({ action: tickActionName, job_id: jobId, _self_tick: true });
  // Wait then fire — wrapped in waitUntil by caller
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  // Re-check cancel just before firing
  const { data: cur } = await admin.from("jst_sync_jobs").select("status, cancel_requested, auto_continue, has_next").eq("id", jobId).maybeSingle();
  if (!cur) return;
  if (cur.status === "cancelled" || cur.cancel_requested === true || cur.auto_continue === false) return;
  if (cur.status === "success") return;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "apikey": SERVICE_ROLE,
        "x-internal-tick": SERVICE_ROLE,
      },
      body,
    });
  } catch (_e) { /* swallow — the next manual / cron tick will pick up */ }
}

/** Decide whether to schedule another self-tick after the current one returned. */
function shouldAutoContinue(result: { status: string; job: any }): boolean {
  if (!result || !result.job) return false;
  if (result.job.auto_continue === false) return false;
  if (result.job.cancel_requested === true) return false;
  const s = result.status;
  if (s === "partial" || s === "waiting_next_tick" || s === "running") return true;
  return false;
}

/**
 * Handle start/tick/cancel actions for an edge function. Returns null if the
 * action wasn't a job action, letting the caller fall through to legacy behavior.
 *
 * Backend auto-continue: when start succeeds or a tick finishes with more work,
 * the helper schedules the next tick via EdgeRuntime.waitUntil(...) self-invoke.
 */
export async function handleJobActions(opts: {
  action: string;
  body: any;
  syncType: JobSyncType;
  callerUid: string | null;
  processPage: ProcessPageFn;
  startActionName: string;
  tickActionName: string;
  cancelActionName: string;
  /** Edge function name (folder under supabase/functions). Required for backend auto-continue. */
  functionName: string;
  config?: Partial<JobConfig>;
  resolveWindowFromBody: (body: any) => { from: Date; to: Date };
}): Promise<Response | null> {
  const headers = { "Content-Type": "application/json" };
  const cfg = { ...DEFAULT_JOB_CONFIG, ...(opts.config ?? {}) };

  const triggerSelfTick = (jobId: string, delayMs: number) => {
    try {
      // @ts-ignore EdgeRuntime is available in Supabase Edge Runtime
      EdgeRuntime.waitUntil(scheduleNextTick(opts.functionName, opts.tickActionName, jobId, delayMs));
    } catch (_e) { /* not in edge runtime */ }
  };

  if (opts.action === opts.startActionName) {
    const { from, to } = opts.resolveWindowFromBody(opts.body);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400_000));
    const requestedRange = opts.body.requested_range ?? (days <= 1 ? "1d" : days <= 7 ? "7d" : days <= 30 ? "30d" : "custom");
    const job = await createJob({
      syncType: opts.syncType,
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      triggerType: opts.body.trigger_type ?? "manual",
      requestedRange,
      createdBy: opts.callerUid,
      config: cfg,
    });
    // Schedule first tick on the backend
    triggerSelfTick(job.id, 200);
    return new Response(JSON.stringify({
      ok: true, job_id: job.id, parent_log_id: job.parent_log_id,
      total_windows: job.total_windows, reused: !!(job as any)._reused,
      auto_continue: true,
    }), { headers });
  }

  if (opts.action === opts.tickActionName) {
    const jobId = String(opts.body.job_id ?? "");
    if (!jobId) throw new Error("缺少 job_id");
    const result = await tickJob(jobId, opts.processPage, cfg);
    if (result.status === "locked") {
      return new Response(JSON.stringify({ ok: true, status: "locked", message: "another tick is running" }), { headers });
    }
    if (shouldAutoContinue(result as any)) {
      const ct = Number((result.job as any)?.metadata?.consecutive_transient ?? 0);
      const delay = result.status === "waiting_next_tick" ? backoffMs(ct) : 500;
      triggerSelfTick(jobId, delay);
    }
    return new Response(JSON.stringify({ ok: true, status: result.status, job: result.job }), { headers });
  }

  if (opts.action === opts.cancelActionName) {
    const jobId = String(opts.body.job_id ?? "");
    if (!jobId) throw new Error("缺少 job_id");
    const result = await cancelJob(jobId);
    return new Response(JSON.stringify(result), { headers, status: result.ok ? 200 : 404 });
  }

  return null;
}
