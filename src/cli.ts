#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import {
  cmuxOk,
  cmuxPingError,
  commandPath,
  configureCmuxAutomationMode,
  doctor,
  formatDoctor,
  hasCmux,
  installCmuxViaHomebrew,
  isAccessDeniedError,
  launchCmuxApp,
  openWorkspace,
  readConfig,
  waitForCmux,
} from "./cmux.js";

interface ParsedArgs {
  command: string;
  path?: string;
  browser?: string;
  yes: boolean;
  help: boolean;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }

  switch (parsed.command) {
    case "doctor":
      console.log(formatDoctor(doctor(parsed.path ? resolve(parsed.path) : process.cwd())));
      return;
    case "install-cmux":
    case "install":
      await installCmux(parsed.yes);
      return;
    case "configure-cmux":
    case "configure":
      await configureCmux(parsed.yes);
      return;
    case "open":
      await open(parsed);
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: "open", yes: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--yes" || arg === "-y") parsed.yes = true;
    else if (arg === "--browser") {
      const value = args[++i];
      if (!value) throw new Error("--browser requires a URL");
      parsed.browser = value;
    } else if (arg.startsWith("--browser=")) parsed.browser = arg.slice("--browser=".length);
    else rest.push(arg);
  }
  if (rest[0] && ["open", "doctor", "install-cmux", "install", "configure-cmux", "configure"].includes(rest[0])) {
    parsed.command = rest.shift()!;
  }
  if (rest[0]) parsed.path = rest[0];
  return parsed;
}

async function open(parsed: ParsedArgs) {
  if (!hasCmux()) {
    const installed = await maybeInstallCmux(parsed.yes);
    if (!installed) {
      console.error(missingCmuxMessage());
      process.exitCode = 1;
      return;
    }
  }

  const cwd = resolve(parsed.path ?? process.cwd());
  if (!(await ensureCmuxReady(parsed.yes))) return;

  const { config } = readConfig(cwd);
  const result = openWorkspace(cwd, config, parsed.browser);
  if (!result.ok) {
    console.error(result.output || "Failed to open cmux workspace.");
    process.exitCode = 1;
    return;
  }
  if (result.output) console.log(result.output);
  console.log(`Opened Pi workspace in cmux: ${cwd}`);
}

async function ensureCmuxReady(yes: boolean): Promise<boolean> {
  if (cmuxOk()) return true;

  console.log("cmux is installed, but its socket is not ready. Starting the cmux app...");
  launchCmuxApp();
  if (waitForCmux()) return true;

  const error = cmuxPingError();
  if (isAccessDeniedError(error)) {
    const configured = await maybeConfigureCmux(yes);
    if (configured && waitForCmux()) return true;
    console.error(cmuxAccessDeniedMessage());
    process.exitCode = 1;
    return false;
  }

  console.error(cmuxNotReadyMessage(error));
  process.exitCode = 1;
  return false;
}

async function installCmux(yes: boolean) {
  if (hasCmux()) {
    console.log(`cmux is already installed: ${commandPath("cmux")}`);
    return;
  }
  const ok = await confirmInstall(yes);
  if (!ok) {
    console.log("Install cancelled.");
    return;
  }
  const status = installCmuxViaHomebrew("inherit");
  if (status !== 0) process.exitCode = status;
}

async function maybeInstallCmux(yes: boolean): Promise<boolean> {
  const ok = await confirmInstall(yes);
  if (!ok) return false;
  return installCmuxViaHomebrew("inherit") === 0 && hasCmux();
}

async function configureCmux(yes: boolean) {
  const ok = await confirmConfigure(yes);
  if (!ok) {
    console.log("Configuration cancelled.");
    return;
  }
  const status = configureCmuxAutomationMode();
  if (status !== 0) {
    console.error("Failed to configure cmux Automation mode.");
    process.exitCode = status;
    return;
  }
  if (!waitForCmux()) {
    console.error(cmuxNotReadyMessage(cmuxPingError()));
    process.exitCode = 1;
    return;
  }
  console.log("cmux Automation mode is enabled and the socket is reachable.");
}

async function maybeConfigureCmux(yes: boolean): Promise<boolean> {
  const ok = await confirmConfigure(yes);
  if (!ok) return false;
  return configureCmuxAutomationMode() === 0;
}

async function confirmInstall(yes: boolean): Promise<boolean> {
  if (!commandPath("brew")) {
    console.error("Homebrew was not found. Install cmux manually from https://github.com/manaflow-ai/cmux or install Homebrew first.");
    return false;
  }
  if (yes) return true;
  console.log(missingCmuxMessage());
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Install cmux via Homebrew now? [y/N] ");
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function confirmConfigure(yes: boolean): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  if (yes) return true;
  console.log(cmuxAccessDeniedMessage());
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Enable cmux Automation mode and restart cmux now? [y/N] ");
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function cmuxAccessDeniedMessage(): string {
  return [
    "cmux is running, but it is refusing external CLI connections.",
    "",
    "pi-cmux needs cmux's Socket Control Mode set to Automation mode so commands run from your normal shell can create workspaces.",
    "This writes this macOS preference and restarts cmux:",
    "  defaults write com.cmuxterm.app socketControlMode automation",
    "",
    "You can also do this from cmux Settings → Automation → Socket Control Mode.",
    "",
    "Run:",
    "  pi-cmux configure-cmux",
  ].join("\n");
}

function cmuxNotReadyMessage(error?: string): string {
  return [
    "cmux is installed, but `cmux ping` still failed.",
    "",
    "If this is the first launch, open /Applications/cmux.app, complete any macOS prompts or onboarding, then run:",
    "  pi-cmux open",
    "",
    error ? `Last error: ${error}` : undefined,
    error ? "" : undefined,
    "Diagnostics:",
    "  pi-cmux doctor",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function missingCmuxMessage(): string {
  return [
    "cmux is required but was not found.",
    "",
    "Install commands:",
    "  brew tap manaflow-ai/cmux",
    "  brew install --cask cmux",
    "",
    "Or run:",
    "  pi-cmux install-cmux",
  ].join("\n");
}

function printHelp() {
  console.log(`pi-cmux — opinionated Pi workspaces for cmux

Usage:
  pi-cmux [open] [path] [--browser <url>]
  pi-cmux doctor [path]
  pi-cmux install-cmux [--yes]
  pi-cmux configure-cmux [--yes]

Examples:
  pi-cmux open
  pi-cmux open ~/project --browser http://localhost:3000
  pi-cmux doctor
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
