# Using `ports` from an AI agent

`ports` shows which programs are listening on which TCP ports on Windows, and can stop them. Use it to free a port, find which dev server is running, or check that the Vexy website (3000) and database (54321 to 54324) are up.

## Rules

- Always pass `--json` and read the JSON. Don't parse the colored tables.
- Check before you stop: run `ports check <port> --json` and make sure the process is the one you mean.
- Stopping needs `--yes` with `--json`. Only add `--force` if a plain stop left it running.
- Never try to stop a process where `"system": true`. `ports` refuses anyway.
- Ask the person before stopping anything they didn't ask you to stop.
- Don't run `ports` with no arguments. That opens the interactive dashboard, which needs a person at the keyboard.

## Commands

| Command | Prints |
| --- | --- |
| `ports list --json` | An array of ports (shape below) |
| `ports check <port> --json` | `{ "port": 3000, "listening": true, "processes": [ ...ports ] }` |
| `ports kill <port> --yes --json` | `{ "port": 3000, "stopped": [{ "pid", "process" }], "leftRunning": [{ "pid", "process", "reason" }] }` |
| `ports watch --json --interval 2` | One JSON line per change until stopped: `{ "time", "event": "started" or "stopped", ...port }` |

Each port looks like this. Details Windows wouldn't give are `null`.

```json
{
  "port": 3000,
  "pid": 8812,
  "process": "node.exe",
  "command": "node C:\\code\\vexy\\node_modules\\next\\dist\\bin\\next dev",
  "memoryBytes": 94371840,
  "startedAt": "2026-10-19T11:00:00.000Z",
  "uptimeSeconds": 3600,
  "system": false,
  "vexy": "Vexy website",
  "project": { "name": "vexy", "framework": "Next.js", "frameworkVersion": "16.3.8", "dir": "C:\\code\\vexy" }
}
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Worked |
| 1 | Couldn't scan or act (for example, not on Windows). With `--json` the reason is in `{ "error": "..." }` |
| 2 | Bad command or option, like a port outside 1 to 65535, or `kill --json` without `--yes` |
| 3 | Nothing is listening on that port |
| 4 | A program was left running (refused, not confirmed, or the stop failed) |

## Working on this repo

`npm run build` compiles to `dist/`, `npm test` runs the tests (build first), `npm run typecheck` checks types. The live tests only run on Windows; CI runs them on every pull request.
