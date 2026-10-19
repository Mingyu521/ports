#!/usr/bin/env node
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { createInterface } from "node:readline/promises";
import { canStop, openBrowser, openEditor, stopProcess } from "./actions.ts";
import { runDashboard } from "./dashboard.tsx";
import { addDetails } from "./details.ts";
import { scanPorts, ScanError } from "./scan.ts";
import { renderCheck, renderTable } from "./table.ts";

const program = new Command();

program
  .name("ports")
  .description("See which programs are using which ports on this Windows computer, and stop the ones you don't need. A Vexy admin tool.")
  .version("0.2.0")
  .addHelpText("after", "\nRun `ports` on its own for the live dashboard.");

// Commander checks the port before any command runs.
function portNumber(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InvalidArgumentError("Use a port number from 1 to 65535.");
  return port;
}

const scanAll = async () => addDetails(await scanPorts());
const onPort = async (port: number) => addDetails((await scanPorts()).filter((r) => r.port === port));

// Shows a clear red message instead of a stack trace when something fails.
function friendly<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (e) {
      const why = e instanceof ScanError ? e.message : `Unexpected problem: ${e instanceof Error ? e.message : String(e)}`;
      console.error(chalk.red(`Couldn't scan ports. ${why}`));
      process.exitCode = 1;
    }
  };
}

program
  .command("list")
  .description("show every listening TCP port with its program, project, memory and uptime")
  .addHelpText("after", "\nExample:\n  $ ports list\n\nVexy's own ports are labelled: 3000 is the Vexy website and 54321-54324 is the Vexy database.")
  .action(friendly(async () => console.log(renderTable(await scanAll()))));

program
  .command("check")
  .description("show everything about the program on one port")
  .argument("<port>", "port number, like 3000", portNumber)
  .addHelpText("after", "\nExample:\n  $ ports check 3000")
  .action(friendly(async (port: number) => console.log(renderCheck(port, await onPort(port)))));

program
  .command("kill")
  .description("stop the program listening on a port")
  .argument("<port>", "port number, like 3000", portNumber)
  .option("-f, --force", "stop it even if it won't close by itself")
  .option("-y, --yes", "don't ask first")
  .addHelpText("after", "\nExample:\n  $ ports kill 3000\n\nParts of Windows itself are never stopped.")
  .action(
    friendly(async (port: number, opts: { force?: boolean; yes?: boolean }) => {
      const rows = await onPort(port);
      if (rows.length === 0) return console.log(chalk.yellow(`Nothing is listening on port ${port}.`));
      for (const row of rows) {
        const why = canStop(row.pid, row.process);
        if (why) {
          console.error(chalk.red(`Won't stop ${row.process} (PID ${row.pid}): ${why}.`));
          process.exitCode = 1;
          continue;
        }
        if (!opts.yes && !(await confirm(`Stop ${row.process} (PID ${row.pid}) on port ${port}? (y/N) `))) {
          console.log("Left it running.");
          continue;
        }
        try {
          await stopProcess(row.pid, opts.force);
          console.log(chalk.green(`Stopped ${row.process} (PID ${row.pid}) on port ${port}.`));
        } catch (e) {
          console.error(chalk.red(`Couldn't stop ${row.process}: ${e instanceof Error ? e.message : String(e)}`));
          if (!opts.force) console.error(`Try ${chalk.green(`ports kill ${port} --force`)}.`);
          process.exitCode = 1;
        }
      }
    }),
  );

program
  .command("open")
  .description("open http://localhost:<port> in your browser")
  .argument("<port>", "port number, like 3000", portNumber)
  .action(friendly(async (port: number) => openBrowser(port)));

program
  .command("dash", { isDefault: true })
  .description("live dashboard that refreshes every few seconds (this is what `ports` on its own runs)")
  .action(
    friendly(async () => {
      if (!process.stdout.isTTY || !process.stdin.isTTY) return console.log(renderTable(await scanAll()));
      await scanPorts(); // fails fast with a clear message on a computer ports can't read
      await runDashboard({ scan: scanAll, actions: { stop: stopProcess, openBrowser, openEditor } });
    }),
  );

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

await program.parseAsync();
