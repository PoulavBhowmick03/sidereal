// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DemoTask = "auth" | "amm-routes" | "frontend-proof";

interface DemoRequest {
  task?: DemoTask;
}

interface TaskConfig {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs: number;
}

interface ActiveDemoTask {
  task: DemoTask;
  label: string;
  commandLine: string;
  startedAt: number;
  lastOutputAt: number;
  stdout: string;
  stderr: string;
}

type DemoGlobal = typeof globalThis & {
  __siderealActiveDemoTask?: ActiveDemoTask;
};

const MAX_OUTPUT_CHARS = 80_000;

function demoGlobal(): DemoGlobal {
  return globalThis as DemoGlobal;
}

function repoRoot(): string {
  return path.basename(process.cwd()) === "app"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
}

function demoApiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SIDEREAL_ENABLE_DEMO_API === "1";
}

function taskConfig(task: DemoTask): TaskConfig {
  switch (task) {
    case "auth":
      return {
        label: "Flash auth invariant",
        command: "cargo",
        args: ["test", "-p", "sidereal-integration-tests", "--test", "auth_invariants"],
        timeoutMs: 5 * 60_000,
      };
    case "amm-routes":
      return {
        label: "Testnet AMM route proof",
        command: "bash",
        args: ["scripts/prove-testnet-amm-routes.sh"],
        env: {
          DEPLOY_IDENTITY: process.env.DEPLOY_IDENTITY ?? "sidereal-smoke",
          SETTLE_SECONDS: process.env.SETTLE_SECONDS ?? "4",
        },
        timeoutMs: 20 * 60_000,
      };
    case "frontend-proof":
      return {
        label: "Frontend proof deployment smoke",
        command: "bash",
        args: ["scripts/check-frontend-testnet.sh"],
        env: {
          PROOF_FILE: "deployments/amm-routes-testnet.state.env",
          RUN_STATIC: "0",
          RUN_E2E: "1",
        },
        timeoutMs: 8 * 60_000,
      };
  }
}

function trimOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return output.slice(output.length - MAX_OUTPUT_CHARS);
}

function appendTaskOutput(activeTask: ActiveDemoTask, stream: "stdout" | "stderr", chunk: string) {
  activeTask[stream] = trimOutput(activeTask[stream] + chunk);
  activeTask.lastOutputAt = Date.now();
}

async function runTask(config: TaskConfig, activeTask: ActiveDemoTask): Promise<{
  code: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(config.command, config.args, {
      cwd: repoRoot(),
      env: {
        ...process.env,
        ...config.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      stderr += `\nTimed out after ${config.timeoutMs}ms\n`;
      appendTaskOutput(activeTask, "stderr", `\nTimed out after ${config.timeoutMs}ms\n`);
      child.kill("SIGTERM");
    }, config.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout = trimOutput(stdout + text);
      appendTaskOutput(activeTask, "stdout", text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr = trimOutput(stderr + text);
      appendTaskOutput(activeTask, "stderr", text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        code: 1,
        durationMs: Date.now() - started,
        stdout,
        stderr: trimOutput(`${stderr}\n${error.message}`),
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        code,
        durationMs: Date.now() - started,
        stdout,
        stderr,
      });
    });
  });
}

export async function POST(request: Request) {
  if (!demoApiEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Demo automation API is disabled in production" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as DemoRequest;
  const task = body.task;
  if (task !== "auth" && task !== "amm-routes" && task !== "frontend-proof") {
    return NextResponse.json({ ok: false, error: "Unknown demo task" }, { status: 400 });
  }

  const config = taskConfig(task);
  const state = demoGlobal();
  if (state.__siderealActiveDemoTask) {
    return NextResponse.json(
      {
        ok: false,
        task,
        label: config.label,
        code: 1,
        durationMs: 0,
        stdout: "",
        stderr: `Demo task ${state.__siderealActiveDemoTask.task} is already running`,
      },
      { status: 409 },
    );
  }

  const activeTask = {
    task,
    label: config.label,
    commandLine: [config.command, ...config.args].join(" "),
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    stdout: "",
    stderr: "",
  };
  state.__siderealActiveDemoTask = activeTask;
  try {
    const result = await runTask(config, activeTask);
    return NextResponse.json({
      ok: result.code === 0,
      task,
      label: config.label,
      ...result,
    });
  } finally {
    if (state.__siderealActiveDemoTask === activeTask) {
      state.__siderealActiveDemoTask = undefined;
    }
  }
}

export async function GET() {
  if (!demoApiEnabled()) {
    return NextResponse.json(
      { active: false, error: "Demo automation API is disabled in production" },
      { status: 403 },
    );
  }

  const activeTask = demoGlobal().__siderealActiveDemoTask;
  if (!activeTask) {
    return NextResponse.json({ active: false });
  }

  return NextResponse.json({
    active: true,
    task: activeTask.task,
    label: activeTask.label,
    commandLine: activeTask.commandLine,
    startedAt: activeTask.startedAt,
    lastOutputAt: activeTask.lastOutputAt,
    durationMs: Date.now() - activeTask.startedAt,
    stdout: activeTask.stdout,
    stderr: activeTask.stderr,
  });
}
