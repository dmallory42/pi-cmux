#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import {
  cmuxOk,
  commandPath,
  doctor,
  formatDoctor,
  hasCmux,
  installCmuxViaHomebrew,
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
  if (rest[0] && ["open", "doctor", "install-cmux", "install"].includes(rest[0])) {
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
  if (!cmuxOk()) {
    console.log("cmux is installed, but its socket is not ready. Starting the cmux app...");
    launchCmuxApp();
    if (!waitForCmux()) {
      console.error(cmuxNotReadyMessage());
      process.exitCode = 1;
      return;
    }
  }

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

function cmuxNotReadyMessage(): string {
  return [
    "cmux is installed, but `cmux ping` still failed.",
    "",
    "If this is the first launch, open /Applications/cmux.app, complete any macOS prompts or onboarding, then run:",
    "  pi-cmux open",
    "",
    "Diagnostics:",
    "  pi-cmux doctor",
  ].join("\n");
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
