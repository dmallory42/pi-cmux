import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export interface PiCmuxConfig {
  name?: string;
  browser?: string;
  pi?: {
    command?: string;
    args?: string[];
  };
  notifications?: {
    onAgentEnd?: boolean;
  };
}

export interface DoctorResult {
  platform: string;
  cmuxPath?: string;
  cmuxPing: "ok" | "failed" | "not-found";
  homebrewPath?: string;
  insideCmux: boolean;
  workspaceId?: string;
  surfaceId?: string;
  socketPath?: string;
  configPath?: string;
}

export function commandPath(command: string): string | undefined {
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

export function hasCmux(): boolean {
  return Boolean(commandPath("cmux"));
}

export function runCmux(args: string[], options: { input?: string; timeoutMs?: number } = {}) {
  return spawnSync("cmux", args, {
    input: options.input,
    encoding: "utf8",
    stdio: options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    timeout: options.timeoutMs ?? 10_000,
  });
}

export function cmuxOk(): boolean {
  if (!hasCmux()) return false;
  return runCmux(["ping"], { timeoutMs: 3_000 }).status === 0;
}

export function insideCmux(): boolean {
  return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID || process.env.CMUX_TAB_ID);
}

export function doctor(cwd = process.cwd()): DoctorResult {
  const cmuxPath = commandPath("cmux");
  const configPath = findConfigPath(cwd);
  let cmuxPing: DoctorResult["cmuxPing"] = "not-found";
  if (cmuxPath) cmuxPing = runCmux(["ping"], { timeoutMs: 3_000 }).status === 0 ? "ok" : "failed";
  return {
    platform: process.platform,
    cmuxPath,
    cmuxPing,
    homebrewPath: commandPath("brew"),
    insideCmux: insideCmux(),
    workspaceId: process.env.CMUX_WORKSPACE_ID,
    surfaceId: process.env.CMUX_SURFACE_ID,
    socketPath: process.env.CMUX_SOCKET_PATH || process.env.CMUX_SOCKET,
    configPath,
  };
}

export function formatDoctor(result: DoctorResult): string {
  return [
    "pi-cmux doctor",
    `platform: ${result.platform}`,
    `cmux: ${result.cmuxPath ?? "not found"}`,
    `cmux ping: ${result.cmuxPing}`,
    `homebrew: ${result.homebrewPath ?? "not found"}`,
    `inside cmux: ${result.insideCmux ? "yes" : "no"}`,
    `workspace: ${result.workspaceId ?? "-"}`,
    `surface: ${result.surfaceId ?? "-"}`,
    `socket: ${result.socketPath ?? "-"}`,
    `config: ${result.configPath ?? "-"}`,
  ].join("\n");
}

export function readConfig(cwd = process.cwd()): { path?: string; config: PiCmuxConfig } {
  const path = findConfigPath(cwd);
  if (!path) return { config: {} };
  try {
    return { path, config: JSON.parse(readFileSync(path, "utf8")) as PiCmuxConfig };
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function findConfigPath(cwd = process.cwd()): string | undefined {
  const path = resolve(cwd, ".pi-cmux.json");
  return existsSync(path) ? path : undefined;
}

export function workspaceName(cwd: string, config: PiCmuxConfig): string {
  return config.name?.trim() || basename(resolve(cwd));
}

export function buildPiCommand(config: PiCmuxConfig): string {
  const command = config.pi?.command || "pi";
  const args = config.pi?.args || [];
  return [command, ...args].map(shellQuote).join(" ");
}

export function openWorkspace(cwd: string, config: PiCmuxConfig, browser?: string): { ok: boolean; output: string } {
  const name = workspaceName(cwd, config);
  const piCommand = buildPiCommand(config);
  const args = ["new-workspace", "--cwd", cwd, "--name", name, "--command", piCommand];
  const result = runCmux(args, { timeoutMs: 10_000 });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status !== 0) return { ok: false, output };

  const browserUrl = browser || config.browser;
  if (browserUrl) {
    runCmux(["browser", "open-split", browserUrl], { timeoutMs: 10_000 });
  }
  return { ok: true, output };
}

export function setStatus(value: string): void {
  if (!hasCmux() || !insideCmux()) return;
  runCmux(["set-status", "pi", value], { timeoutMs: 2_000 });
}

export function log(message: string): void {
  if (!hasCmux() || !insideCmux()) return;
  runCmux(["log", message], { timeoutMs: 2_000 });
}

export function notify(title: string, body: string): void {
  if (!hasCmux() || !insideCmux()) return;
  runCmux(["notify", "--title", title, "--body", body], { timeoutMs: 2_000 });
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function installCmuxViaHomebrew(stdio: "inherit" | "pipe" = "inherit"): number {
  if (!commandPath("brew")) return 127;
  const tap = spawnSync("brew", ["tap", "manaflow-ai/cmux"], { stdio });
  if (tap.status !== 0) return tap.status ?? 1;
  const install = spawnSync("brew", ["install", "--cask", "cmux"], { stdio });
  return install.status ?? 1;
}

export function currentPiSessionId(ctx: unknown): string | undefined {
  const maybeCtx = ctx as { sessionManager?: { getSessionId?: () => unknown } };
  const value = maybeCtx.sessionManager?.getSessionId?.();
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function moveCommandForSession(sessionId: string): string {
  return `pi --session ${shellQuote(sessionId)}`;
}
