// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DemoTaskId = "auth" | "amm-routes";
type DemoStatus = "idle" | "running" | "passed" | "failed";
type DemoLogLevel = "info" | "error";
type DemoOutputStream = "stdout" | "stderr";
type DemoRunnerAvailability = "checking" | "available" | "unavailable";

declare global {
  interface Window {
    __siderealDemoStarted?: boolean;
  }
}

interface DemoStep {
  id: DemoTaskId;
  title: string;
  detail: string;
}

interface DemoResult {
  ok: boolean;
  task: DemoTaskId;
  label: string;
  code: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

interface DemoLogEntry {
  id: number;
  time: string;
  level: DemoLogLevel;
  message: string;
  detail?: string;
}

interface DemoStatusPoll {
  active: boolean;
  task?: DemoTaskId;
  label?: string;
  commandLine?: string;
  startedAt?: number;
  lastOutputAt?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  result?: DemoResult;
}

interface DemoTaskOutput {
  stdout: string;
  stderr: string;
}

type OutputOffsets = Record<DemoTaskId, Record<DemoOutputStream, number>>;

const DEPLOYMENT_ROWS = [
  { key: "ADMIN", name: "Admin account", kind: "account" },
  { key: "UNDERLYING", name: "Underlying SAC", kind: "contract" },
  { key: "SY", name: "SY wrapper", kind: "contract" },
  { key: "PT", name: "Principal token", kind: "contract" },
  { key: "YT", name: "Yield token", kind: "contract" },
  { key: "TOKENIZER", name: "Tokenizer", kind: "contract" },
  { key: "AMM", name: "AMM", kind: "contract" },
] as const;
const STEPS: DemoStep[] = [
  {
    id: "auth",
    title: "Auth invariant",
    detail: "Runs the host-level invariant that keeps flash-route auth pinned to exact contracts, functions, args, and amounts.",
  },
  {
    id: "amm-routes",
    title: "Live AMM proof",
    detail: "Deploys a fresh 90-day testnet market, seeds liquidity, then executes SY/PT and SY/YT routes.",
  },
];

const MAX_LOG_ENTRIES = 400;
const HEARTBEAT_MS = 15_000;
const POLL_MS = 2_000;
const TASK_TIMEOUT_MS: Record<DemoTaskId, number> = {
  auth: 6 * 60_000,
  "amm-routes": 25 * 60_000,
};
const STELLAR_EXPERT_TESTNET = "https://stellar.expert/explorer/testnet";

function duration(ms?: number): string {
  if (ms === undefined) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function statusLabel(status: DemoStatus): string {
  switch (status) {
    case "idle":
      return "Waiting";
    case "running":
      return "Running";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
  }
}

function cleanOutput(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function explorerUrl(address: string): string | null {
  if (address.startsWith("C")) return `${STELLAR_EXPERT_TESTNET}/contract/${address}`;
  if (address.startsWith("G")) return `${STELLAR_EXPERT_TESTNET}/account/${address}`;
  return null;
}

function extractDeploymentValue(output: string, key: string): string | null {
  const cleaned = cleanOutput(output);
  if (key === "ADMIN") {
    return (
      cleaned.match(/ADMIN="?([G][A-Z0-9]{55})"?/)?.[1] ??
      cleaned.match(/Identity:\s+\S+\s+=\s+([G][A-Z0-9]{55})/)?.[1] ??
      null
    );
  }
  if (key === "UNDERLYING") {
    return (
      cleaned.match(/UNDERLYING="?([C][A-Z0-9]{55})"?/)?.[1] ??
      cleaned.match(/Underlying SAC:\s+([C][A-Z0-9]{55})/)?.[1] ??
      null
    );
  }
  return cleaned.match(new RegExp(`${key}="?([C][A-Z0-9]{55})"?`))?.[1] ?? null;
}

function initialOffsets(): OutputOffsets {
  return {
    auth: { stdout: 0, stderr: 0 },
    "amm-routes": { stdout: 0, stderr: 0 },
  };
}

function lineLevel(line: string): DemoLogLevel {
  const normalized = line.toLowerCase();
  if (
    normalized.includes("test result: ok") ||
    /\b0 failed\b/.test(normalized) ||
    /\bok:\b/.test(normalized) ||
    /\bpassed\b/.test(normalized)
  ) {
    return "info";
  }

  return /\b(error|failed|failure|panic|timed out|timeout|not found|missingvalue|txbadseq|tryagainlater)\b/i.test(line)
    ? "error"
    : "info";
}

function logTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function detectDemoRunnerAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/api/demo", { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function failedStartResult(step: DemoStep, response: Response, value: Partial<DemoResult> & { error?: string }): DemoResult {
  return {
    ok: false,
    task: step.id,
    label: step.title,
    code: value.code ?? response.status,
    durationMs: value.durationMs ?? 0,
    stdout: value.stdout ?? "",
    stderr: [value.error, value.stderr].filter(Boolean).join("\n"),
    error: value.error,
  };
}

export default function DemoPage() {
  const started = useRef(false);
  const logId = useRef(0);
  const streamOffsets = useRef<OutputOffsets>(initialOffsets());
  const streamedCommand = useRef<Partial<Record<DemoTaskId, boolean>>>({});
  const heartbeatAt = useRef<Partial<Record<DemoTaskId, number>>>({});
  const [hasStarted, setHasStarted] = useState(false);
  const [statuses, setStatuses] = useState<Record<DemoTaskId, DemoStatus>>({
    auth: "idle",
    "amm-routes": "idle",
  });
  const [results, setResults] = useState<Partial<Record<DemoTaskId, DemoResult>>>({});
  const [liveOutputs, setLiveOutputs] = useState<Partial<Record<DemoTaskId, DemoTaskOutput>>>({});
  const [activeOutput, setActiveOutput] = useState<DemoTaskId>("auth");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<DemoLogEntry[]>([]);
  const [runnerAvailability, setRunnerAvailability] = useState<DemoRunnerAvailability>("checking");

  useEffect(() => {
    let mounted = true;
    void detectDemoRunnerAvailable().then((available) => {
      if (mounted) setRunnerAvailability(available ? "available" : "unavailable");
    });
    return () => {
      mounted = false;
    };
  }, []);

  const allPassed = useMemo(
    () => STEPS.every((step) => statuses[step.id] === "passed"),
    [statuses],
  );

  const runnerAvailable = runnerAvailability === "available";

  const failedStep = useMemo(
    () => STEPS.find((step) => statuses[step.id] === "failed"),
    [statuses],
  );

  const completedSteps = useMemo(
    () => STEPS.filter((step) => statuses[step.id] === "passed" || statuses[step.id] === "failed").length,
    [statuses],
  );

  const progressPercent = useMemo(() => {
    if (allPassed) return 100;
    if (!hasStarted) return 0;
    const activeWeight = running ? 0.35 : 0;
    return Math.min(99, Math.round(((completedSteps + activeWeight) / STEPS.length) * 100));
  }, [allPassed, completedSteps, hasStarted, running]);

  const activeStep = STEPS.find((step) => statuses[step.id] === "running") ?? failedStep;

  const appendLogEntries = useCallback((entries: Array<Omit<DemoLogEntry, "id" | "time">>) => {
    if (entries.length === 0) return;
    const nextEntries = entries.map((entry) => {
      logId.current += 1;
      return {
        ...entry,
        id: logId.current,
        time: logTime(),
        detail: entry.detail ? cleanOutput(entry.detail).trim() : undefined,
      };
    });
    setLogs((prev) => [...prev, ...nextEntries].slice(-MAX_LOG_ENTRIES));
  }, []);

  const appendLog = useCallback((level: DemoLogLevel, message: string, detail?: string) => {
    appendLogEntries([{ level, message, detail }]);
  }, [appendLogEntries]);

  const appendStreamOutput = useCallback((step: DemoStep, stream: DemoOutputStream, value: string) => {
    const offsets = streamOffsets.current[step.id];
    if (offsets[stream] > value.length) offsets[stream] = 0;

    const chunk = value.slice(offsets[stream]);
    offsets[stream] = value.length;

    const lines = cleanOutput(chunk)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    appendLogEntries(
      lines.map((line) => ({
        level: stream === "stderr" ? lineLevel(line) : lineLevel(line),
        message: `${step.title}: ${line}`,
      })),
    );
  }, [appendLogEntries]);

  const pollTaskStatus = useCallback(async (step: DemoStep) => {
    const response = await fetch("/api/demo", { cache: "no-store" });
    if (!response.ok) return undefined;

    const status = (await response.json()) as DemoStatusPoll;
    if (status.result?.task === step.id) {
      setLiveOutputs((prev) => ({
        ...prev,
        [step.id]: {
          stdout: status.result?.stdout ?? "",
          stderr: status.result?.stderr ?? "",
        },
      }));
      appendStreamOutput(step, "stdout", status.result.stdout ?? "");
      appendStreamOutput(step, "stderr", status.result.stderr ?? "");
      return status;
    }

    if (!status.active || status.task !== step.id) return status;

    setLiveOutputs((prev) => ({
      ...prev,
      [step.id]: {
        stdout: status.stdout ?? "",
        stderr: status.stderr ?? "",
      },
    }));

    if (status.commandLine && !streamedCommand.current[step.id]) {
      streamedCommand.current[step.id] = true;
      appendLog("info", `${step.title} command`, status.commandLine);
    }

    appendStreamOutput(step, "stdout", status.stdout ?? "");
    appendStreamOutput(step, "stderr", status.stderr ?? "");

    const elapsed = status.durationMs ?? 0;
    const previousHeartbeat = heartbeatAt.current[step.id] ?? 0;
    if (elapsed - previousHeartbeat >= HEARTBEAT_MS) {
      heartbeatAt.current[step.id] = elapsed;
      const lastOutputAgo = status.lastOutputAt ? Date.now() - status.lastOutputAt : elapsed;
      appendLog(
        "info",
        `${step.title} still running after ${duration(elapsed)}`,
        `Last command output was ${duration(lastOutputAgo)} ago.`,
      );
    }
    return status;
  }, [appendLog, appendStreamOutput]);

  const waitForTaskResult = useCallback(async (step: DemoStep): Promise<DemoResult> => {
    const deadline = Date.now() + TASK_TIMEOUT_MS[step.id];
    while (Date.now() < deadline) {
      const status = await pollTaskStatus(step);
      if (status?.result?.task === step.id) return status.result;
      await sleep(POLL_MS);
    }

    return {
      ok: false,
      task: step.id,
      label: step.title,
      code: 1,
      durationMs: TASK_TIMEOUT_MS[step.id],
      stdout: liveOutputs[step.id]?.stdout ?? "",
      stderr: `Timed out waiting for ${step.title} to finish`,
    };
  }, [liveOutputs, pollTaskStatus]);

  const runAll = useCallback(async () => {
    if (!runnerAvailable) {
      appendLog(
        "info",
        "Demo runner is local-only",
        "Open /demo from a local development server such as http://127.0.0.1:3117/demo.",
      );
      return;
    }
    if (running || started.current || window.__siderealDemoStarted) return;
    started.current = true;
    window.__siderealDemoStarted = true;
    setHasStarted(true);
    setRunning(true);
    logId.current = 0;
    streamOffsets.current = initialOffsets();
    streamedCommand.current = {};
    heartbeatAt.current = {};
    setLogs([]);
    setLiveOutputs({});
    setResults({});
    setStatuses({
      auth: "idle",
      "amm-routes": "idle",
    });
    appendLog("info", "Demo started");

    let finished = true;
    for (const step of STEPS) {
      setActiveOutput(step.id);
      setStatuses((prev) => ({ ...prev, [step.id]: "running" }));
      appendLog("info", `${step.title} started`);
      try {
        const response = await fetch("/api/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: step.id, async: true }),
        });
        const start = (await response.json().catch(() => ({ ok: false, error: "Demo API did not return JSON" }))) as
          Partial<DemoResult> & { started?: boolean; error?: string };
        const result =
          response.ok && start.ok && start.started
            ? await waitForTaskResult(step)
            : start.task === step.id && typeof start.ok === "boolean"
              ? (start as DemoResult)
              : failedStartResult(step, response, start);
        appendStreamOutput(step, "stdout", result.stdout ?? "");
        appendStreamOutput(step, "stderr", result.stderr ?? "");
        setLiveOutputs((prev) => ({
          ...prev,
          [step.id]: {
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
          },
        }));
        setResults((prev) => ({ ...prev, [step.id]: result }));
        setStatuses((prev) => ({ ...prev, [step.id]: result.ok ? "passed" : "failed" }));
        if (result.ok) {
          appendLog("info", `${step.title} passed in ${duration(result.durationMs)}`);
        } else {
          finished = false;
          appendLog(
            "error",
            `${step.title} failed with exit ${result.code ?? "n/a"}`,
            [result.error, result.stderr, result.stdout].filter(Boolean).join("\n"),
          );
          break;
        }
      } catch (error) {
        const result: DemoResult = {
          ok: false,
          task: step.id,
          label: step.title,
          code: 1,
          durationMs: 0,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
        };
        setResults((prev) => ({ ...prev, [step.id]: result }));
        setLiveOutputs((prev) => ({
          ...prev,
          [step.id]: {
            stdout: result.stdout,
            stderr: result.stderr,
          },
        }));
        setStatuses((prev) => ({ ...prev, [step.id]: "failed" }));
        finished = false;
        appendLog("error", `${step.title} failed before output was returned`, result.stderr);
        break;
      }
    }
    if (finished) appendLog("info", "Demo complete");
    setRunning(false);
  }, [appendLog, appendStreamOutput, runnerAvailable, running, waitForTaskResult]);

  const current = results[activeOutput];
  const proofOutput = liveOutputs["amm-routes"]?.stdout || results["amm-routes"]?.stdout || "";
  const deploymentLinks = DEPLOYMENT_ROWS.map((row) => {
    const value = extractDeploymentValue(proofOutput, row.key);
    return {
      ...row,
      value,
      url: value ? explorerUrl(value) : null,
    };
  });

  return (
    <div className="space-y-10">
      <section className="card overflow-hidden p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="label-data">Run progress</p>
            <p className="mt-1 text-sm text-smoke">
              {allPassed
                ? "Complete"
                : failedStep
                  ? `Failed at ${failedStep.title}`
                  : running && activeStep
                    ? `Running ${activeStep.title}`
                    : hasStarted
                      ? "Started"
                      : "Ready"}
            </p>
          </div>
          <span className="font-mono text-sm tabular-nums text-paper">{progressPercent}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
          className="mt-5 h-2 overflow-hidden rounded-pill bg-white/10"
        >
          <div
            className={`h-full rounded-pill transition-all duration-500 ${
              failedStep ? "bg-red-300" : allPassed ? "bg-emerald-300" : "bg-amber"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </section>

      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <h1 className="text-5xl font-light tracking-tight sm:text-6xl">Demo</h1>
          <p className="max-w-2xl text-smoke">
            {runnerAvailable
              ? "Run the automated integration proof from the UI. A controlled backend runs the auth invariant, deploys a fresh testnet market, seeds liquidity, executes every AMM route, and streams the raw output here."
              : "The automated runner needs either local development or the hosted runner configuration. It runs CLI commands and testnet transactions from a controlled backend."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={hasStarted || !runnerAvailable}
          className="btn-solid w-full lg:w-auto"
        >
          {running ? (
            <span
              aria-hidden
              className="h-3.5 w-3.5 animate-spin rounded-pill border border-ink/40 border-t-ink"
            />
          ) : null}
          {runnerAvailability === "checking"
            ? "Checking runner"
            : !runnerAvailable
              ? "Run locally"
              : running
                ? "Running demo"
                : allPassed
                  ? "Demo complete"
                  : hasStarted
                    ? "Demo started"
                    : "Run full demo"}
        </button>
      </header>

      <section className="panel-subtle p-5">
        <p className="label-data">What this demo proves</p>
        <div className="mt-4 grid gap-4 text-sm text-smoke md:grid-cols-2">
          <p>
            It verifies the strict flash-route auth invariant, then performs a live testnet deployment of SY,
            PT, YT, tokenizer, and AMM contracts from the hosted runner.
          </p>
          <p>
            It initializes the market, deposits and splits SY, seeds AMM liquidity, executes SY-&gt;PT,
            PT-&gt;SY, SY-&gt;YT, and YT-&gt;SY swaps, then records explorer links and final command output.
          </p>
          <p className="md:col-span-2">
            It does not submit transactions from a browser wallet. Freighter, xBull, and Lobstr signing still need
            a separate manual wallet pass.
          </p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        {STEPS.map((step, index) => {
          const status = statuses[step.id];
          const result = results[step.id];
          const active = activeOutput === step.id;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveOutput(step.id)}
              className={`card min-h-[190px] p-6 text-left transition ${
                active ? "border-paper/40" : "hover:border-white/25"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <span className="label-data">Step {index + 1}</span>
                <span
                  className={`text-[13px] uppercase tracking-[0.12em] ${
                    status === "passed"
                      ? "text-emerald-300"
                      : status === "failed"
                        ? "text-red-300"
                        : status === "running"
                          ? "text-amber"
                          : "text-ash"
                  }`}
                >
                  {statusLabel(status)}
                </span>
              </div>
              <h2 className="mt-5 text-2xl font-light text-paper">{step.title}</h2>
              <p className="mt-3 text-sm text-smoke">{step.detail}</p>
              {result ? (
                <p className="mt-5 text-[13px] tabular-nums text-ash">
                  exit {result.code ?? "n/a"} - {duration(result.durationMs)}
                </p>
              ) : null}
            </button>
          );
        })}
      </section>

      <section className="grid gap-6 lg:grid-cols-12">
        <div className="panel-subtle p-5 lg:col-span-4">
          <p className="label-data">Latest proof deployment</p>
          <dl className="mt-5 space-y-3 text-sm">
            {deploymentLinks.map((entry) => {
              return (
                <div key={entry.key} className="border-t border-white/10 pt-3">
                  <dt className="flex items-center justify-between gap-3">
                    <span className="label-data">{entry.name}</span>
                    <span className="text-[11px] uppercase tracking-[0.12em] text-ash">{entry.kind}</span>
                  </dt>
                  <dd className="mt-2 break-all font-mono text-[13px] text-paper">
                    {entry.value && entry.url ? (
                      <div className="space-y-1.5">
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noreferrer"
                          className="transition hover:text-amber"
                        >
                          {entry.value}
                        </a>
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block font-sans text-[12px] uppercase tracking-[0.12em] text-amber transition hover:text-paper"
                        >
                          Open explorer
                        </a>
                      </div>
                    ) : (
                      "n/a"
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        <div className="card overflow-hidden lg:col-span-8">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <p className="label-data">Output</p>
            <span className="text-[13px] text-ash">{STEPS.find((s) => s.id === activeOutput)?.title}</span>
          </div>
          <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-5 font-mono text-[12px] leading-relaxed text-smoke">
            {current
              ? cleanOutput([current.stdout, current.stderr].filter(Boolean).join("\n"))
              : "No output yet."}
          </pre>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <p className="label-data">Logs</p>
          <span className="text-[13px] text-ash">{logs.length} entries</span>
        </div>
        <div className="max-h-[360px] overflow-auto p-5">
          {logs.length === 0 ? (
            <p className="font-mono text-[12px] text-ash">No logs yet.</p>
          ) : (
            <ol className="space-y-4">
              {logs.map((entry) => (
                <li key={entry.id} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[12px] tabular-nums text-ash">{entry.time}</span>
                    <span
                      className={`text-[12px] uppercase tracking-[0.12em] ${
                        entry.level === "error" ? "text-red-300" : "text-emerald-300"
                      }`}
                    >
                      {entry.level}
                    </span>
                    <span className="text-sm text-paper">{entry.message}</span>
                  </div>
                  {entry.detail ? (
                    <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/20 p-3 font-mono text-[12px] leading-relaxed text-smoke">
                      {entry.detail}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
