# ports

See which programs are using which ports on your Windows computer. A Vexy admin tool.

```
> ports list
PORT   PID   PROCESS                 VEXY
135    1032  svchost.exe
3000   8812  node.exe                Vexy website
54322  5120  com.docker.backend.exe  Vexy database
3 listening ports
```

Vexy's own ports are labelled, so you can tell at a glance whether the Vexy website (3000) and the Vexy database (54321 to 54324) are running.

## Install

You need Windows and [Node.js](https://nodejs.org) 22.18 or newer.

In PowerShell:

```powershell
git clone https://github.com/Mingyu521/ports
cd ports
npm install
npm link
```

`npm install` also builds the command. `npm link` installs `ports` globally, so it works from any folder. Open a new PowerShell window and run:

```powershell
ports list
ports --help
```

To remove it later, run `npm unlink -g ports`.

## How it works

`ports list` runs two commands that come with Windows: `netstat -ano` for the listening TCP ports and their process IDs, and `tasklist` for the program names. A program listening on the same port through both IPv4 and IPv6 shows up once.

- `src/scan.ts` finds the ports (the scanner).
- `src/table.ts` draws the table.
- `src/labels.ts` knows Vexy's ports.
- `src/cli.ts` is the command itself.

## Develop

```powershell
npm run build      # compile TypeScript into dist/
npm test           # run the tests (build first)
npm run typecheck
```

The tests include a live check that starts a throwaway server and makes sure `ports list` finds it once. It runs on Windows only; GitHub runs it on every pull request.
