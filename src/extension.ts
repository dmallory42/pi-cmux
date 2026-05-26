import type { AgentEndEvent, ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  browserAutomationArgs,
  clearProgress,
  currentPiSessionId,
  defaultBrowserSurface,
  doctor,
  formatDoctor,
  hasCmux,
  insideCmux,
  log,
  moveCommandForSession,
  notify,
  readConfig,
  readScreen,
  runCmux,
  setProgress,
  setStatus,
} from "./cmux.js";

export default function piCmuxExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!insideCmux()) return;
    setStatus("Ready");
    log(`Pi session ready in ${ctx.cwd}`);
  });

  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!insideCmux()) return;
    setStatus("Running");
    log("Pi prompt submitted");
  });

  pi.on("agent_start", async () => {
    if (!insideCmux()) return;
    setStatus("Running");
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!insideCmux()) return;
    setStatus("Ready");
    log("Pi response complete");
    const { config } = safeReadConfig(ctx.cwd);
    if (config.notifications?.onAgentEnd) notify("Pi", summarizeAgentEnd(event));
  });

  pi.on("session_shutdown", async () => {
    if (!insideCmux()) return;
    setStatus("Stopped");
    log("Pi session stopped");
  });

  pi.registerCommand("cmux", {
    description: "Control and inspect the current cmux workspace",
    handler: async (args, ctx) => handleCmuxCommand(args, ctx),
  });
}

async function handleCmuxCommand(rawArgs: string, ctx: ExtensionCommandContext) {
  const [command = "help", ...rest] = splitArgs(rawArgs);
  switch (command) {
    case "help":
    case "":
      ctx.ui.notify(helpText(), "info");
      return;
    case "doctor":
      ctx.ui.notify(formatDoctor(doctor(ctx.cwd)), "info");
      return;
    case "browser":
      await browser(rest, ctx);
      return;
    case "screen":
      await screen(rest, ctx);
      return;
    case "progress":
      await progress(rest, ctx);
      return;
    case "status":
      await status(rest, ctx);
      return;
    case "log":
      await sidebarLog(rest, ctx);
      return;
    case "move":
      await move(ctx);
      return;
    default:
      ctx.ui.notify(`Unknown /cmux command: ${command}\n\n${helpText()}`, "warning");
  }
}

async function browser(args: string[], ctx: ExtensionCommandContext) {
  const [command, ...rest] = args;
  if (command === "url" || command === "reload" || command === "snapshot") {
    await browserAutomation(command, ctx);
    return;
  }
  if (command === "open") {
    await openBrowser(rest[0], ctx);
    return;
  }
  if (command === "help") {
    ctx.ui.notify(browserHelpText(), "info");
    return;
  }
  await openBrowser(command, ctx);
}

async function openBrowser(urlArg: string | undefined, ctx: ExtensionCommandContext) {
  const url = urlArg || safeReadConfig(ctx.cwd).config.browser;
  if (!url) {
    ctx.ui.notify("Usage: /cmux browser <url>\n\nNo browser URL was provided and .pi-cmux.json has no `browser` value.", "warning");
    return;
  }
  if (!ensureUsableCmux(ctx)) return;
  const result = runCmux(["browser", "open-split", url], { timeoutMs: 10_000 });
  if (result.status !== 0) {
    ctx.ui.notify(commandOutput(result) || "Failed to open cmux browser split.", "error");
    return;
  }
  log(`Opened browser: ${url}`);
  ctx.ui.notify(`Opened browser split: ${url}`, "info");
}

async function browserAutomation(command: "url" | "reload" | "snapshot", ctx: ExtensionCommandContext) {
  if (!ensureUsableCmux(ctx)) return;
  const surface = defaultBrowserSurface();
  const result = runCmux(browserAutomationArgs(command, surface), { timeoutMs: 10_000 });
  if (result.status !== 0) {
    const hint = surface ? "" : "\n\nNo browser surface was found automatically. Open one with `/cmux browser <url>` first.";
    ctx.ui.notify(commandOutput(result) || `Failed to run cmux browser ${command}.${hint}`, "error");
    return;
  }
  const output = commandOutput(result);
  if (command === "reload") {
    ctx.ui.notify("Reloaded cmux browser.", "info");
    return;
  }
  ctx.ui.notify(output || `cmux browser ${command} completed.`, "info");
}

async function screen(args: string[], ctx: ExtensionCommandContext) {
  const linesArg = args[0];
  let lines: number | undefined;
  if (linesArg !== undefined) {
    const parsed = Number(linesArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      ctx.ui.notify("Usage: /cmux screen [positive-line-count]", "warning");
      return;
    }
    lines = parsed;
  }
  if (!ensureUsableCmux(ctx)) return;
  const result = readScreen(lines);
  if (result.status !== 0) {
    ctx.ui.notify(commandOutput(result) || "Failed to read cmux screen.", "error");
    return;
  }
  ctx.ui.notify(commandOutput(result) || "cmux screen is empty.", "info");
}

async function progress(args: string[], ctx: ExtensionCommandContext) {
  const [value, ...labelParts] = args;
  if (value === "clear") {
    if (!ensureUsableCmux(ctx)) return;
    const result = clearProgress();
    if (result.status !== 0) {
      ctx.ui.notify(commandOutput(result) || "Failed to clear cmux progress.", "error");
      return;
    }
    ctx.ui.notify("Cleared cmux progress.", "info");
    return;
  }

  const percent = Number(value);
  if (!value || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    ctx.ui.notify("Usage: /cmux progress <0-100> [label]\n       /cmux progress clear", "warning");
    return;
  }
  if (!ensureUsableCmux(ctx)) return;
  const label = labelParts.join(" ").trim() || undefined;
  const result = setProgress(percent, label);
  if (result.status !== 0) {
    ctx.ui.notify(commandOutput(result) || "Failed to set cmux progress.", "error");
    return;
  }
  ctx.ui.notify(`cmux progress set: ${percent}%${label ? ` — ${label}` : ""}`, "info");
}

async function status(args: string[], ctx: ExtensionCommandContext) {
  const value = args.join(" ").trim();
  if (!value) {
    ctx.ui.notify("Usage: /cmux status <value>", "warning");
    return;
  }
  if (!ensureUsableCmux(ctx)) return;
  setStatus(value);
  ctx.ui.notify(`cmux status set: ${value}`, "info");
}

async function sidebarLog(args: string[], ctx: ExtensionCommandContext) {
  const message = args.join(" ").trim();
  if (!message) {
    ctx.ui.notify("Usage: /cmux log <message>", "warning");
    return;
  }
  if (!ensureUsableCmux(ctx)) return;
  log(message);
  ctx.ui.notify("Added cmux sidebar log entry.", "info");
}

async function move(ctx: ExtensionCommandContext) {
  if (!hasCmux()) {
    ctx.ui.notify("cmux was not found. Run `pi-cmux install-cmux` from your shell.", "warning");
    return;
  }
  const sessionId = currentPiSessionId(ctx);
  if (!sessionId) {
    ctx.ui.notify("Could not determine the current Pi session id, so this session cannot be moved into cmux.", "warning");
    return;
  }
  const { config } = safeReadConfig(ctx.cwd);
  const command = moveCommandForSession(sessionId);
  const name = config.name || `Pi: ${ctx.cwd.split("/").filter(Boolean).at(-1) || "session"}`;
  const result = runCmux(["new-workspace", "--cwd", ctx.cwd, "--name", name, "--command", command, "--focus", "true"], {
    timeoutMs: 10_000,
  });
  if (result.status !== 0) {
    ctx.ui.notify(result.stderr || "Failed to create cmux workspace for this Pi session.", "error");
    return;
  }
  ctx.ui.notify("Opened this Pi session in a new cmux workspace.", "info");
}

function ensureUsableCmux(ctx: ExtensionCommandContext): boolean {
  if (!hasCmux()) {
    ctx.ui.notify("cmux was not found. Run `pi-cmux install-cmux` from your shell.", "warning");
    return false;
  }
  if (!insideCmux()) {
    ctx.ui.notify("This Pi session is not running inside cmux. Use `/cmux move` or launch with `pi-cmux open`.", "warning");
    return false;
  }
  return true;
}

function safeReadConfig(cwd: string): ReturnType<typeof readConfig> {
  try {
    return readConfig(cwd);
  } catch {
    return { config: {} };
  }
}

function summarizeAgentEnd(event: AgentEndEvent): string {
  const message = lastAssistantMessage(event);
  if (!message) return "Response complete";
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}

function lastAssistantMessage(event: AgentEndEvent): string | undefined {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index] as { role?: unknown; content?: unknown };
    if (message?.role !== "assistant") continue;
    const text = textFromContent(message.content);
    if (text) return text;
  }
  return undefined;
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((block) => {
      const typed = block as { type?: unknown; text?: unknown };
      return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
    })
    .filter(Boolean);
  return parts.join("\n").trim() || undefined;
}

function commandOutput(result: { stdout?: string; stderr?: string }): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function splitArgs(input: string): string[] {
  return input.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

function browserHelpText(): string {
  return [
    "pi-cmux browser commands:",
    "  /cmux browser <url>",
    "  /cmux browser open <url>",
    "  /cmux browser url",
    "  /cmux browser reload",
    "  /cmux browser snapshot",
  ].join("\n");
}

function helpText(): string {
  return [
    "pi-cmux commands:",
    "  /cmux doctor",
    "  /cmux browser <url>",
    "  /cmux browser url|reload|snapshot",
    "  /cmux screen [lines]",
    "  /cmux progress <0-100> [label]",
    "  /cmux progress clear",
    "  /cmux move",
    "  /cmux status <value>",
    "  /cmux log <message>",
  ].join("\n");
}
