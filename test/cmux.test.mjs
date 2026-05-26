import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  browserAutomationArgs,
  commandForPane,
  extractCmuxRef,
  findFirstBrowserSurface,
  openWorkspace,
  resolveWorkspaceConfig,
} from "../dist/cmux.js";

test("resolveWorkspaceConfig returns top-level config without a preset", () => {
  const result = resolveWorkspaceConfig({ name: "Project", browser: "http://localhost:3000" });

  assert.equal(result.ok, true);
  assert.equal(result.config.name, "Project");
  assert.equal(result.config.browser, "http://localhost:3000");
});

test("resolveWorkspaceConfig applies preset overrides", () => {
  const result = resolveWorkspaceConfig(
    {
      name: "Project",
      browser: "http://localhost:3000",
      panes: [{ command: "npm run dev" }],
      presets: {
        review: {
          name: "Review",
          browser: "http://localhost:8080",
          panes: [{ type: "browser", url: "http://localhost:8080" }],
          pi: { command: "pi", args: ["--model", "reviewer"] },
        },
      },
    },
    "review",
  );

  assert.equal(result.ok, true);
  assert.equal(result.config.name, "Review");
  assert.equal(result.config.browser, "http://localhost:8080");
  assert.deepEqual(result.config.panes, [{ type: "browser", url: "http://localhost:8080" }]);
  assert.deepEqual(result.config.pi, { command: "pi", args: ["--model", "reviewer"] });
});

test("resolveWorkspaceConfig inherits top-level values when preset omits them", () => {
  const result = resolveWorkspaceConfig(
    {
      browser: "http://localhost:3000",
      pi: { command: "pi", args: ["--model", "sonnet"] },
      notifications: { onAgentEnd: true },
      presets: {
        minimal: { name: "Minimal" },
      },
    },
    "minimal",
  );

  assert.equal(result.ok, true);
  assert.equal(result.config.name, "Minimal");
  assert.equal(result.config.browser, "http://localhost:3000");
  assert.deepEqual(result.config.pi, { command: "pi", args: ["--model", "sonnet"] });
  assert.deepEqual(result.config.notifications, { onAgentEnd: true });
});

test("resolveWorkspaceConfig reports missing presets with available names", () => {
  const result = resolveWorkspaceConfig({ presets: { frontend: {}, review: {} } }, "missing");

  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown pi-cmux preset: missing/);
  assert.match(result.error, /frontend, review/);
});

test("commandForPane runs pane commands from project cwd by default", () => {
  assert.equal(commandForPane("/repo", { command: "npm run dev" }), "cd '/repo' && npm run dev");
});

test("commandForPane resolves relative pane cwd", () => {
  assert.equal(commandForPane("/repo", { command: "npm test", cwd: "packages/app" }), "cd '/repo/packages/app' && npm test");
});

test("extractCmuxRef finds refs in JSON and text output", () => {
  assert.equal(extractCmuxRef('{"workspace":"workspace:9","surface":"surface:4"}', "workspace"), "workspace:9");
  assert.equal(extractCmuxRef("created pane:2 with surface:7", "surface"), "surface:7");
});

test("findFirstBrowserSurface picks the first browser surface from tree JSON", () => {
  const tree = {
    workspaces: [
      {
        panes: [
          { type: "terminal", ref: "surface:1" },
          { type: "browser", surface: "surface:2", url: "http://localhost:3000" },
        ],
      },
    ],
  };

  assert.equal(findFirstBrowserSurface(tree), "surface:2");
});

test("browserAutomationArgs targets a discovered browser surface", () => {
  assert.deepEqual(browserAutomationArgs("snapshot", "surface:2"), ["browser", "--surface", "surface:2", "snapshot", "--compact"]);
});

test("openWorkspace preserves the default lightweight workspace behavior", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  };

  const result = openWorkspace("/repo", {}, undefined, runner);

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "--json",
    "--id-format",
    "refs",
    "new-workspace",
    "--cwd",
    "/repo",
    "--name",
    "repo",
    "--command",
    "'pi'",
    "--focus",
    "true",
  ]);
});

test("openWorkspace creates browser and terminal panes with public cmux commands", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args.includes("new-workspace")) return { status: 0, stdout: '{"workspace":"workspace:9"}', stderr: "" };
    if (args.includes("new-pane")) return { status: 0, stdout: '{"surface":"surface:5"}', stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };

  const result = openWorkspace(
    "/repo",
    {
      name: "Project",
      browser: "http://localhost:3000",
      panes: [
        { name: "Dev", command: "npm run dev", direction: "right" },
        { type: "browser", name: "Docs", url: "https://example.com", direction: "down" },
      ],
    },
    undefined,
    runner,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(calls[0], [
    "--json",
    "--id-format",
    "refs",
    "new-workspace",
    "--cwd",
    "/repo",
    "--name",
    "Project",
    "--command",
    "'pi'",
    "--focus",
    "true",
  ]);
  assert.deepEqual(calls[1], ["browser", "open-split", "http://localhost:3000", "--workspace", "workspace:9", "--focus", "false"]);
  assert.deepEqual(calls[2], [
    "--json",
    "--id-format",
    "refs",
    "new-pane",
    "--type",
    "terminal",
    "--direction",
    "right",
    "--workspace",
    "workspace:9",
    "--focus",
    "false",
  ]);
  assert.deepEqual(calls[3], ["respawn-pane", "--workspace", "workspace:9", "--surface", "surface:5", "--command", "cd '/repo' && npm run dev"]);
  assert.deepEqual(calls[4], ["rename-tab", "--workspace", "workspace:9", "--surface", "surface:5", "Dev"]);
  assert.deepEqual(calls[5], [
    "--json",
    "--id-format",
    "refs",
    "new-pane",
    "--type",
    "browser",
    "--direction",
    "down",
    "--workspace",
    "workspace:9",
    "--url",
    "https://example.com",
    "--focus",
    "false",
  ]);
  assert.deepEqual(calls[6], ["rename-tab", "--workspace", "workspace:9", "--surface", "surface:5", "Docs"]);
});

test("openWorkspace lets CLI browser override configured browser", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args.includes("new-workspace")) return { status: 0, stdout: '{"workspace":"workspace:9"}', stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };

  const result = openWorkspace("/repo", { browser: "http://configured.example" }, "http://override.example", runner);

  assert.equal(result.ok, true);
  assert.deepEqual(calls[1], ["browser", "open-split", "http://override.example", "--workspace", "workspace:9", "--focus", "false"]);
});

test("openWorkspace surfaces configured pane failures as warnings", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args.includes("new-workspace")) return { status: 0, stdout: '{"workspace":"workspace:9"}', stderr: "" };
    if (args.includes("new-pane")) return { status: 1, stdout: "", stderr: "pane failed" };
    return { status: 0, stdout: "", stderr: "" };
  };

  const result = openWorkspace("/repo", { panes: [{ command: "npm run dev" }] }, undefined, runner);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(result.warnings[0], /pane failed/);
});

test("openWorkspace warns when cmux does not return a workspace handle", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "{}", stderr: "" };
  };

  const result = openWorkspace("/repo", { panes: [{ command: "npm run dev" }] }, undefined, runner);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(result.warnings[0], /workspace handle/);
});

test("CLI reports missing presets before trying to contact cmux", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cmux-test-"));
  try {
    writeFileSync(join(dir, ".pi-cmux.json"), JSON.stringify({ presets: { frontend: {} } }));
    const result = spawnSync(process.execPath, ["dist/cli.js", "open", dir, "--preset", "missing"], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown pi-cmux preset: missing/);
    assert.match(result.stderr, /Available presets: frontend/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
