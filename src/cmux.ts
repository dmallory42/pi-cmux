import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

export type PaneDirection = "left" | "right" | "up" | "down";

export interface PiCmuxPaneBase {
  name?: string;
  direction?: PaneDirection;
  focus?: boolean;
}

export interface PiCmuxTerminalPane extends PiCmuxPaneBase {
  type?: "terminal";
  command: string;
  cwd?: string;
}

export interface PiCmuxBrowserPane extends PiCmuxPaneBase {
  type: "browser";
  url: string;
}

export type PiCmuxPane = PiCmuxTerminalPane | PiCmuxBrowserPane;

export interface PiCmuxPreset {
  name?: string;
  browser?: string;
  panes?: PiCmuxPane[];
  pi?: {
    command?: string;
    args?: string[];
  };
  notifications?: {
    onAgentEnd?: boolean;
  };
}

export interface PiCmuxConfig extends PiCmuxPreset {
  presets?: Record<string, PiCmuxPreset>;
}

export interface ResolvedPiCmuxConfig extends PiCmuxPreset {
  panes?: PiCmuxPane[];
}

export interface ResolveConfigResult {
  ok: boolean;
  config?: ResolvedPiCmuxConfig;
  error?: string;
}

export interface DoctorResult {
  platform: string;
  cwd: string;
  cmuxPath?: string;
  cmuxPing: "ok" | "failed" | "not-found";
  cmuxAppRunning: boolean;
  homebrewPath?: string;
  insideCmux: boolean;
  workspaceId?: string;
  surfaceId?: string;
  socketPath?: string;
  configPath?: string;
}

export interface CmuxRunOptions {
  input?: string;
  timeoutMs?: number;
}

export interface CmuxRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type CmuxRunner = (args: string[], options?: CmuxRunOptions) => CmuxRunResult;

export interface OpenWorkspaceResult {
  ok: boolean;
  output: string;
  warnings: string[];
}

export function commandPath(command: string): string | undefined {
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

export function hasCmux(): boolean {
  return Boolean(commandPath("cmux"));
}

export function runCmux(args: string[], options: CmuxRunOptions = {}): CmuxRunResult {
  const result = spawnSync("cmux", args, {
    input: options.input,
    encoding: "utf8",
    stdio: options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    timeout: options.timeoutMs ?? 10_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function cmuxOk(): boolean {
  if (!hasCmux()) return false;
  return runCmux(["ping"], { timeoutMs: 3_000 }).status === 0;
}

export function cmuxPingError(): string {
  if (!hasCmux()) return "cmux not found";
  const result = runCmux(["ping"], { timeoutMs: 3_000 });
  return commandOutput(result);
}

export function isAccessDeniedError(message: string): boolean {
  return message.includes("Access denied") || message.includes("only processes started inside cmux can connect");
}

export function cmuxAppRunning(): boolean {
  if (process.platform !== "darwin") return false;
  return spawnSync("pgrep", ["-x", "cmux"], { stdio: "ignore" }).status === 0;
}

export function launchCmuxApp(): boolean {
  if (process.platform !== "darwin") return false;
  const result = spawnSync("open", ["-a", "cmux"], { stdio: "ignore", timeout: 10_000 });
  return result.status === 0;
}

export function waitForCmux(timeoutMs = 15_000): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cmuxOk()) return true;
    sleep(500);
  }
  return cmuxOk();
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
    cwd: resolve(cwd),
    cmuxPath,
    cmuxPing,
    cmuxAppRunning: cmuxAppRunning(),
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
    `cwd: ${result.cwd}`,
    `cmux: ${result.cmuxPath ?? "not found"}`,
    `cmux ping: ${result.cmuxPing}`,
    `cmux app running: ${result.cmuxAppRunning ? "yes" : "no"}`,
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

export function resolveWorkspaceConfig(config: PiCmuxConfig, presetName?: string): ResolveConfigResult {
  const base = withoutPresets(config);
  if (!presetName) return { ok: true, config: base };

  const preset = config.presets?.[presetName];
  if (!preset) {
    const names = Object.keys(config.presets ?? {}).sort();
    const suffix = names.length ? ` Available presets: ${names.join(", ")}.` : " No presets are configured.";
    return { ok: false, error: `Unknown pi-cmux preset: ${presetName}.${suffix}` };
  }

  return {
    ok: true,
    config: {
      ...base,
      ...definedOverrides(preset),
      pi: preset.pi ?? base.pi,
      notifications: preset.notifications ?? base.notifications,
      panes: preset.panes ?? base.panes,
    },
  };
}

export function workspaceName(cwd: string, config: ResolvedPiCmuxConfig): string {
  return config.name?.trim() || basename(resolve(cwd));
}

export function buildPiCommand(config: ResolvedPiCmuxConfig): string {
  const command = config.pi?.command || "pi";
  const args = config.pi?.args || [];
  return [command, ...args].map(shellQuote).join(" ");
}

export function openWorkspace(
  cwd: string,
  config: ResolvedPiCmuxConfig,
  browser?: string,
  runner: CmuxRunner = runCmux,
): OpenWorkspaceResult {
  const warnings: string[] = [];
  const name = workspaceName(cwd, config);
  const piCommand = buildPiCommand(config);
  const args = ["--json", "--id-format", "refs", "new-workspace", "--cwd", cwd, "--name", name, "--command", piCommand, "--focus", "true"];
  const result = runner(args, { timeoutMs: 10_000 });
  const output = commandOutput(result);
  if (result.status !== 0) return { ok: false, output, warnings };

  const browserUrl = browser || config.browser;
  const panes = config.panes ?? [];
  if (!browserUrl && panes.length === 0) return { ok: true, output: "", warnings };

  const workspaceRef = extractCmuxRef(output, "workspace");
  if (!workspaceRef) {
    warnings.push("Opened the Pi workspace, but cmux did not return a workspace handle, so configured browser/panes could not be added.");
    return { ok: true, output: "", warnings };
  }

  if (browserUrl) {
    const browserResult = runner(["browser", "open-split", browserUrl, "--workspace", workspaceRef, "--focus", "false"], { timeoutMs: 10_000 });
    if (browserResult.status !== 0) warnings.push(`Failed to open browser ${browserUrl}: ${commandOutput(browserResult) || "unknown error"}`);
  }

  for (const pane of panes) {
    openConfiguredPane(cwd, workspaceRef, pane, runner, warnings);
  }

  return { ok: true, output: "", warnings };
}

export function setStatus(value: string): void {
  if (!hasCmux() || !insideCmux()) return;
  runCmux(["set-status", "pi", value], { timeoutMs: 2_000 });
}

export function log(message: string): void {
  if (!hasCmux() || !insideCmux()) return;
  runCmux(["log", "--source", "pi", message], { timeoutMs: 2_000 });
}

export function notify(title: string, body: string): void {
  if (!hasCmux() || !insideCmux()) return;
  runCmux(["notify", "--title", title, "--body", body], { timeoutMs: 2_000 });
}

export function setProgress(percent: number, label?: string): CmuxRunResult {
  const args = ["set-progress", (percent / 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")];
  if (label) args.push("--label", label);
  return runCmux(args, { timeoutMs: 2_000 });
}

export function clearProgress(): CmuxRunResult {
  return runCmux(["clear-progress"], { timeoutMs: 2_000 });
}

export function readScreen(lines?: number): CmuxRunResult {
  const args = ["read-screen"];
  if (lines !== undefined) args.push("--lines", String(lines));
  return runCmux(args, { timeoutMs: 5_000 });
}

export function findFirstBrowserSurface(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const values = Object.values(object);
  const type = String(object.type ?? object.kind ?? object.surfaceType ?? "").toLowerCase();
  const hasBrowserUrl = typeof object.url === "string" && /^https?:\/\//.test(object.url);
  if (type.includes("browser") || hasBrowserUrl) {
    const ref = findCmuxRefInValue(value, "surface");
    if (ref) return ref;
  }
  for (const child of values) {
    const ref = findFirstBrowserSurface(child);
    if (ref) return ref;
  }
  return undefined;
}

export function defaultBrowserSurface(runner: CmuxRunner = runCmux): string | undefined {
  if (!insideCmux()) return undefined;
  const args = ["--json", "tree"];
  if (process.env.CMUX_WORKSPACE_ID) args.push("--workspace", process.env.CMUX_WORKSPACE_ID);
  const result = runner(args, { timeoutMs: 3_000 });
  if (result.status !== 0) return undefined;
  try {
    return findFirstBrowserSurface(JSON.parse(result.stdout));
  } catch {
    return undefined;
  }
}

export function browserAutomationArgs(subcommand: "url" | "reload" | "snapshot", surface?: string): string[] {
  const args = ["browser"];
  if (surface) args.push("--surface", surface);
  args.push(subcommand);
  if (subcommand === "snapshot") args.push("--compact");
  return args;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function extractCmuxRef(output: string, kind: "workspace" | "pane" | "surface"): string | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    const fromJson = findCmuxRefInValue(parsed, kind);
    if (fromJson) return fromJson;
  } catch {
    // Fall back to text parsing below.
  }
  return matchCmuxRef(trimmed, kind);
}

function openConfiguredPane(cwd: string, workspaceRef: string, pane: PiCmuxPane, runner: CmuxRunner, warnings: string[]): void {
  if (isBrowserPane(pane)) {
    openBrowserPane(workspaceRef, pane, runner, warnings);
    return;
  }
  openTerminalPane(cwd, workspaceRef, pane, runner, warnings);
}

function openBrowserPane(workspaceRef: string, pane: PiCmuxBrowserPane, runner: CmuxRunner, warnings: string[]): void {
  if (!pane.url?.trim()) {
    warnings.push("Skipped a browser pane without a URL.");
    return;
  }
  const args = [
    "--json",
    "--id-format",
    "refs",
    "new-pane",
    "--type",
    "browser",
    "--direction",
    validDirection(pane.direction),
    "--workspace",
    workspaceRef,
    "--url",
    pane.url,
    "--focus",
    String(pane.focus ?? false),
  ];
  const result = runner(args, { timeoutMs: 10_000 });
  const output = commandOutput(result);
  if (result.status !== 0) {
    warnings.push(`Failed to open browser pane ${pane.url}: ${output || "unknown error"}`);
    return;
  }
  maybeRenamePane(workspaceRef, pane.name, output, runner, warnings);
}

function openTerminalPane(cwd: string, workspaceRef: string, pane: PiCmuxTerminalPane, runner: CmuxRunner, warnings: string[]): void {
  if (!pane.command?.trim()) {
    warnings.push("Skipped a terminal pane without a command.");
    return;
  }

  const paneResult = runner(
    [
      "--json",
      "--id-format",
      "refs",
      "new-pane",
      "--type",
      "terminal",
      "--direction",
      validDirection(pane.direction),
      "--workspace",
      workspaceRef,
      "--focus",
      String(pane.focus ?? false),
    ],
    { timeoutMs: 10_000 },
  );
  const output = commandOutput(paneResult);
  if (paneResult.status !== 0) {
    warnings.push(`Failed to open terminal pane ${pane.name ?? pane.command}: ${output || "unknown error"}`);
    return;
  }

  const surfaceRef = extractCmuxRef(output, "surface");
  if (!surfaceRef) {
    warnings.push(`Opened terminal pane ${pane.name ?? pane.command}, but cmux did not return a surface handle, so its command was not started.`);
    return;
  }

  const command = commandForPane(cwd, pane);
  const commandResult = runner(["respawn-pane", "--workspace", workspaceRef, "--surface", surfaceRef, "--command", command], { timeoutMs: 10_000 });
  if (commandResult.status !== 0) warnings.push(`Failed to start ${pane.name ?? pane.command}: ${commandOutput(commandResult) || "unknown error"}`);
  maybeRenamePane(workspaceRef, pane.name, output, runner, warnings);
}

function maybeRenamePane(workspaceRef: string, name: string | undefined, paneOutput: string, runner: CmuxRunner, warnings: string[]): void {
  const trimmed = name?.trim();
  if (!trimmed) return;
  const surfaceRef = extractCmuxRef(paneOutput, "surface");
  if (!surfaceRef) {
    warnings.push(`Could not name pane ${trimmed} because cmux did not return a surface handle.`);
    return;
  }
  const result = runner(["rename-tab", "--workspace", workspaceRef, "--surface", surfaceRef, trimmed], { timeoutMs: 5_000 });
  if (result.status !== 0) warnings.push(`Could not name pane ${trimmed}: ${commandOutput(result) || "unknown error"}`);
}

export function commandForPane(projectCwd: string, pane: PiCmuxTerminalPane): string {
  const cwd = pane.cwd ? resolvePaneCwd(projectCwd, pane.cwd) : resolve(projectCwd);
  return `cd ${shellQuote(cwd)} && ${pane.command}`;
}

function resolvePaneCwd(projectCwd: string, cwd: string): string {
  return isAbsolute(cwd) ? cwd : resolve(projectCwd, cwd);
}

function validDirection(direction: PaneDirection | undefined): PaneDirection {
  return direction && ["left", "right", "up", "down"].includes(direction) ? direction : "right";
}

function isBrowserPane(pane: PiCmuxPane): pane is PiCmuxBrowserPane {
  return pane.type === "browser" || "url" in pane;
}

function commandOutput(result: CmuxRunResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function findCmuxRefInValue(value: unknown, kind: "workspace" | "pane" | "surface"): string | undefined {
  if (typeof value === "string") return matchCmuxRef(value, kind);
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findCmuxRefInValue(item, kind);
      if (match) return match;
    }
    return undefined;
  }

  const object = value as Record<string, unknown>;
  const preferredKeys = [kind, `${kind}Ref`, `${kind}Id`, "ref", "id"];
  for (const key of preferredKeys) {
    const match = findCmuxRefInValue(object[key], kind);
    if (match) return match;
  }
  for (const child of Object.values(object)) {
    const match = findCmuxRefInValue(child, kind);
    if (match) return match;
  }
  return undefined;
}

function matchCmuxRef(value: string, kind: "workspace" | "pane" | "surface"): string | undefined {
  return value.match(new RegExp(`\\b${kind}:\\d+\\b`))?.[0];
}

function withoutPresets(config: PiCmuxConfig): ResolvedPiCmuxConfig {
  const { presets: _presets, ...rest } = config;
  return definedOverrides(rest);
}

function definedOverrides<T extends object>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function configureCmuxAutomationMode(): number {
  if (process.platform !== "darwin") return 1;
  const write = spawnSync("defaults", ["write", "com.cmuxterm.app", "socketControlMode", "automation"], { stdio: "ignore" });
  if (write.status !== 0) return write.status ?? 1;
  spawnSync("pkill", ["-x", "cmux"], { stdio: "ignore" });
  sleep(750);
  return launchCmuxApp() ? 0 : 1;
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
