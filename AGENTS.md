# pi-cmux Agent Instructions

## Project brief

`pi-cmux` is an opinionated, customizable Pi workspace profile for [cmux](https://github.com/manaflow-ai/cmux).

The goal is not to replace Pi, replace cmux, or copy cmux internals. The goal is to provide a Pi-first layer on top of a user-installed cmux app:

- launch useful cmux workspaces for Pi with one command
- make Pi sessions inside cmux feel native and observable
- expose convenient `/cmux` commands inside Pi
- support project-specific workspace presets through config
- integrate browser panes, lifecycle status, notifications, and logs in a Pi-oriented way

Think of this as: **"when I open a project with Pi in cmux, this is the workspace I want."**

## Product principles

- Do not bundle cmux.
- Do not copy cmux source code or generated hook code.
- Use the public `cmux` CLI as the integration boundary.
- If cmux is missing, prompt the user with clear install instructions and only run installers after explicit confirmation.
- Keep `pi-workbench` separate; this is a cmux-native experiment, not a replacement for the tmux workbench.
- Prefer an opinionated default experience with simple customization over exposing raw cmux mechanics.
- Stay graceful outside cmux: the Pi extension should be quiet unless the user invokes `/cmux`.

## Intended user experience

Install:

```bash
pi install npm:pi-cmux
```

Launch a Pi workspace in cmux:

```bash
pi-cmux open
pi-cmux open ~/project --browser http://localhost:3000
```

Inside Pi:

```text
/cmux doctor
/cmux browser http://localhost:3000
/cmux move
/cmux status "Waiting for review"
/cmux log "Running checks"
```

## Configuration idea

A project can define `.pi-cmux.json`:

```json
{
  "name": "My Project",
  "browser": "http://localhost:3000",
  "pi": {
    "command": "pi",
    "args": []
  },
  "notifications": {
    "onAgentEnd": true
  }
}
```

Future versions may add extra panes, project presets, dev-server commands, test/watch panes, browser profiles, and richer layout definitions.

## MVP scope

Initial useful scope:

- `pi-cmux doctor`
- `pi-cmux install-cmux`
- `pi-cmux open [path] [--browser <url>]`
- `.pi-cmux.json` support for `name`, `browser`, `pi.command`, `pi.args`, and notification defaults
- Pi extension commands:
  - `/cmux doctor`
  - `/cmux browser <url>`
  - `/cmux move`
  - `/cmux status <value>`
  - `/cmux log <message>`
- Pi lifecycle integration:
  - set cmux status to `Ready` on session start
  - set status to `Running` when the agent starts
  - set status to `Ready` when the agent ends
  - optionally send a cmux notification on agent end
  - append lightweight cmux sidebar log entries

## Licensing guidance

This package may use `GPL-3.0-or-later`, but still keep the integration clean:

- Do not vendor cmux binaries.
- Do not copy cmux source.
- Do not depend on private cmux internals.
- Shell out to user-installed `cmux` commands.
- Preserve a clear boundary between `pi-cmux` and cmux distribution.

## Development workflow

- Use TypeScript and keep runtime dependencies minimal.
- Build with `npm run build`.
- Use `npm run check` before calling work complete.
- Add tests when behavior becomes non-trivial.
- Prefer small, focused modules:
  - cmux command helpers
  - CLI parsing/commands
  - Pi extension commands/lifecycle
  - config loading/validation

## Quality bar

- Commands should fail with actionable messages.
- Never silently install cmux or Homebrew dependencies.
- Avoid noisy notifications outside cmux.
- Treat cmux absence as expected, not exceptional.
- Keep defaults safe and easy to understand.
