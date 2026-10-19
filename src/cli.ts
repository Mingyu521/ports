#!/usr/bin/env node
import chalk from "chalk";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { createInterface } from "node:readline/promises";
import { canStop, openBrowser, openEditor, stopProcess } from "./actions.ts";
import { runDashboard } from "./dashboard.tsx";
import { addDetails } from "./details.ts";
import { printJson, toJson } from "./json.ts";
import { scanPorts, ScanError } from "./scan.ts";
import { renderCheck, renderTable } from "./table.ts";
import { changeJson, describeChange, watch } from "./watch.ts";

// Exit codes, so scripts and AI agents can tell what happened without reading text.
export const EXIT = { ok: 0, failed: 1, usage: 2, nothingListening: 3, notStopped: 4 } as const;

const program = new Command();

program
  .name("ports")
  .description("See which programs are using which ports on this Windows computer, and stop the ones you don't need. A Vexy admin tool.")
  .version("0.3.0")
  .exitOverride()
  .addHelpText(
    "after",
    `
Run \`ports\` on its own for the live dashboard.

Exit codes: 0 ok, 1 couldn't scan or act, 2 bad command or option,
3 nothing listening on that port, 4 a program was left running.`,
  );

// Commander checks the port before any command runs.
function portNumber(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError("Use a whole port number from 1 to 65535.");
  }
  return port;
}

function seconds(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.5 || n > 3600) throw new InvalidArgumentError("Use a number of seconds from 0.5 to 3600.");
  return n;
}

const scanAll = async () => addDetails(await scanPorts());
const onPort = async (port: number) => addDetails((await scanPorts()).filter((r) => r.port === port));

// Shows a clear message instead of a stack trace when something fails.
// With --json the error is JSON too.
function friendly<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (e) {
      const why = e instanceof ScanError ? e.message : `Unexpected problem: ${e instanceof Error ? e.message : String(e)}`;
      const opts = args.find((a): a is { json?: boolean } => typeof a === "object" && a !== null && "json" in a);
      if (opts?.json) printJson({ error: `Couldn't scan ports. ${why}` });
      else console.error(chalk.red(`Couldn't scan ports. ${why}`));
      process.exitCode = EXIT.failed;
    }
  };
}

program
  .command("list")
  .description("show every listening TCP port with its program, project, framework, memory and uptime")
  .option("--json", "print JSON for scripts and AI agents")
  .addHelpText("after", "\nExamples:\n  $ ports list\n  $ ports list --json\n\nVexy's own ports are labelled: 3000 is the Vexy website and 54321-54324 is the Vexy database.")
  .action(
    friendly(async (opts: { json?: boolean }) => {
      const rows = await scanAll();
      if (opts.json) printJson(rows.map((r) => toJson(r)));
      else console.log(renderTable(rows));
    }),
  );

program
  .command("check")
  .description("show everything about the program (or programs) on one port")
  .argument("<port>", "port number from 1 to 65535, like 3000", portNumber)
  .option("--json", "print JSON for scripts and AI agents")
  .addHelpText("after", "\nExamples:\n  $ ports check 3000\n  $ ports check 3000 --json")
  .action(
    friendly(async (port: number, opts: { json?: boolean }) => {
      const rows = await onPort(port);
      if (opts.json) printJson({ port, listening: rows.length > 0, processes: rows.map((r) => toJson(r)) });
      else console.log(renderCheck(port, rows));
      if (rows.length === 0) process.exitCode = EXIT.nothingListening;
    }),
  );

program
  .command("kill")
  .description("stop the program listening on a port")
  .argument("<port>", "port number from 1 to 65535, like 3000", portNumber)
  .option("-f, --force", "stop it even if it won't close by itself")
  .option("-y, --yes", "don't ask first (needed with --json)")
  .option("--json", "print JSON for scripts and AI agents")
  .addHelpText("after", "\nExamples:\n  $ ports kill 3000\n  $ ports kill 3000 --yes --json\n\nParts of Windows itself are never stopped.")
  .action(
    friendly(async (port: number, opts: { force?: boolean; yes?: boolean; json?: boolean }) => {
      if (opts.json && !opts.yes) {
        printJson({ error: "Add --yes to stop a program with --json, since there's no one to ask." });
        process.exitCode = EXIT.usage;
        return;
      }
      const rows = await onPort(port);
      const result = { port, stopped: [] as object[], leftRunning: [] as object[] };
      const say = (text: string) => !opts.json && console.log(text);
      if (rows.length === 0) {
        if (opts.json) printJson(result);
        else console.log(chalk.yellow(`Nothing is listening on port ${port}.`));
        process.exitCode = EXIT.nothingListening;
        return;
      }
      for (const row of rows) {
        const who = { pid: row.pid, process: row.process };
        const why = canStop(row.pid, row.process);
        if (why) {
          result.leftRunning.push({ ...who, reason: why });
          say(chalk.red(`Won't stop ${row.process} (PID ${row.pid}): ${why}.`));
          continue;
        }
        if (!opts.yes && !(await confirm(`Stop ${row.process} (PID ${row.pid}) on port ${port}? (y/N) `))) {
          result.leftRunning.push({ ...who, reason: "not confirmed" });
          say("Left it running.");
          continue;
        }
        try {
          await stopProcess(row.pid, opts.force);
          result.stopped.push(who);
          say(chalk.green(`Stopped ${row.process} (PID ${row.pid}) on port ${port}.`));
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          result.leftRunning.push({ ...who, reason });
          say(chalk.red(`Couldn't stop ${row.process}: ${reason}`) + (opts.force ? "" : `\nTry ${chalk.green(`ports kill ${port} --force`)}.`));
        }
      }
      if (opts.json) printJson(result);
      if (result.leftRunning.length) process.exitCode = EXIT.notStopped;
    }),
  );

program
  .command("open")
  .description("open http://localhost:<port> in your browser")
  .argument("<port>", "port number from 1 to 65535, like 3000", portNumber)
  .action(friendly(async (port: number) => openBrowser(port)));

program
  .command("watch")
  .description("log every program that starts or stops listening, with the time, until Ctrl+C")
  .option("-i, --interval <seconds>", "how often to look, in seconds", seconds, 2)
  .option("--json", "print one line of JSON per change")
  .addHelpText("after", "\nExamples:\n  $ ports watch\n  $ ports watch --interval 5 --json > ports-log.jsonl")
  .action(
    friendly(async (opts: { interval: number; json?: boolean }) => {
      const stop = new AbortController();
      process.once("SIGINT", () => stop.abort());
      await watch(
        scanAll,
        opts.interval,
        (change, at) => console.log(opts.json ? changeJson(change, at) : describeChange(change, at)),
        (rows) => !opts.json && console.log(chalk.cyan(`Watching ${rows.length} listening ports every ${opts.interval}s. Press Ctrl+C to stop.`)),
        stop.signal,
      );
    }),
  );

program
  .command("dash", { isDefault: true })
  .description("live dashboard (this is what `ports` on its own runs)")
  .option("-i, --interval <seconds>", "how often to refresh, in seconds", seconds, 3)
  .action(
    friendly(async (opts: { interval: number }) => {
      if (!process.stdout.isTTY || !process.stdin.isTTY) return console.log(renderTable(await scanAll()));
      await scanPorts(); // fails fast with a clear message on a computer ports can't read
      await runDashboard({
        scan: scanAll,
        actions: { stop: stopProcess, openBrowser, openEditor },
        refreshMs: opts.interval * 1000,
        onNewPort: () => process.stdout.write("\u0007"), // terminal bell
      });
    }),
  );

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

try {
  await program.parseAsync();
} catch (e) {
  // Help and --version end here too, with exit code 0.
  if (e instanceof CommanderError) process.exitCode = e.exitCode === 0 ? EXIT.ok : EXIT.usage;
  else throw e;
}
