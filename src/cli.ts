#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import { scanPorts, ScanError } from "./scan.ts";
import { renderTable } from "./table.ts";

const program = new Command();

program
  .name("ports")
  .description("See which programs are using which ports on this Windows computer. A Vexy admin tool.")
  .version("0.1.0");

program
  .command("list")
  .description("show every listening TCP port with its PID and program name")
  .addHelpText(
    "after",
    `
Example:
  $ ports list

Vexy's own ports are labelled: 3000 is the Vexy website and 54321-54324 is the Vexy database.`,
  )
  .action(async () => {
    try {
      console.log(renderTable(await scanPorts()));
    } catch (e) {
      const why = e instanceof ScanError ? e.message : `Unexpected problem: ${e instanceof Error ? e.message : String(e)}`;
      console.error(chalk.red(`Couldn't scan ports. ${why}`));
      process.exitCode = 1;
    }
  });

await program.parseAsync();
