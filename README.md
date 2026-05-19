# pi-cmux

Opinionated Pi workspaces for [cmux](https://github.com/manaflow-ai/cmux).

`pi-cmux` is a small Pi package that launches and enriches Pi sessions inside a user-installed cmux app. It does not bundle cmux and does not copy cmux internals; it uses the public `cmux` CLI.

## Install

```bash
pi install npm:pi-cmux
```

cmux must be installed separately. If it is missing, `pi-cmux` can guide you through the official Homebrew install path.

```bash
pi-cmux install-cmux
```

## Usage

Open the current project in cmux with Pi:

```bash
pi-cmux open
```

Open another project and a browser split:

```bash
pi-cmux open ~/project --browser http://localhost:3000
```

Open a named project preset:

```bash
pi-cmux open --preset frontend
```

Run diagnostics:

```bash
pi-cmux doctor
```

Allow `pi-cmux` to create cmux workspaces from your regular shell:

```bash
pi-cmux configure-cmux
```

This enables cmux's Automation socket mode via macOS preferences and restarts cmux. `pi-cmux open` will offer to do this when cmux refuses external CLI connections.

## Pi commands

After installing the package, Pi gets a `/cmux` command:

```text
/cmux doctor
/cmux browser http://localhost:3000
/cmux browser url
/cmux browser reload
/cmux browser snapshot
/cmux screen 80
/cmux progress 50 "Running checks"
/cmux progress clear
/cmux move
/cmux status "Waiting for review"
/cmux log "Running checks"
```

When Pi runs inside cmux, the extension also updates cmux sidebar status/logs from Pi lifecycle events.

## Project config

Create `.pi-cmux.json` in a project:

```json
{
  "name": "My Project",
  "browser": "http://localhost:3000",
  "panes": [
    {
      "name": "Dev server",
      "command": "npm run dev",
      "direction": "right"
    },
    {
      "type": "browser",
      "name": "Docs",
      "url": "https://example.com/docs",
      "direction": "down"
    }
  ],
  "pi": {
    "command": "pi",
    "args": []
  },
  "notifications": {
    "onAgentEnd": true
  }
}
```

Terminal pane commands run from the project directory by default. Use `cwd` for a pane-specific working directory. Directions can be `left`, `right`, `up`, or `down`.

Presets let a project define focused workspace profiles:

```json
{
  "name": "My Project",
  "browser": "http://localhost:3000",
  "presets": {
    "frontend": {
      "name": "My Project — Frontend",
      "panes": [
        { "name": "Dev server", "command": "npm run dev" },
        { "name": "Tests", "command": "npm test -- --watch", "direction": "down" }
      ]
    },
    "review": {
      "name": "My Project — Review",
      "browser": "http://localhost:8080",
      "panes": []
    }
  }
}
```

Select one with:

```bash
pi-cmux open --preset frontend
```

Preset values override top-level `name`, `browser`, `pi`, `notifications`, and `panes` values.

## Principles

- cmux is installed by the user, not bundled.
- installs are never silent; `pi-cmux` prompts before using Homebrew.
- integration happens through public `cmux` CLI commands.
- outside cmux, the extension stays quiet unless `/cmux` is invoked.

## License

GPL-3.0-or-later.
