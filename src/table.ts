import chalk from "chalk";
import { HIGH_MEMORY, isSystem } from "./actions.ts";
import type { PortDetails } from "./details.ts";
import { formatMemory, formatUptime, shorten } from "./format.ts";
import { vexyLabel } from "./labels.ts";
import { frameworkLabel } from "./project.ts";

const UNAVAILABLE = "unavailable";

type Column = { head: string; cell: (r: PortDetails, now: Date) => string };

const COLUMNS: Column[] = [
  { head: "PORT", cell: (r) => String(r.port) },
  { head: "PID", cell: (r) => String(r.pid) },
  { head: "PROCESS", cell: (r) => r.process },
  { head: "PROJECT", cell: (r) => vexyLabel(r.port) ?? r.project?.name ?? "" },
  { head: "FRAMEWORK", cell: (r) => frameworkLabel(r.project) },
  { head: "MEMORY", cell: (r) => formatMemory(r.memory) },
  { head: "UPTIME", cell: (r, now) => formatUptime(r.started, now) },
];

// Colors a row: Windows' own programs dimmed, Vexy in magenta.
function paintRow(r: PortDetails, text: string): string {
  if (isSystem(r.pid, r.process)) return chalk.dim(text);
  if (vexyLabel(r.port)) return chalk.magenta(text);
  return text;
}

// Turns the scan into a table. It only formats text, so it's easy to test.
// Columns with nothing in them are left out, and memory over 500 MB is red.
export function renderTable(rows: PortDetails[], now = new Date()): string {
  if (rows.length === 0) {
    return chalk.yellow("No ports are listening right now.") + "\nStart a server (for example `npm run dev`) and run `ports list` again.";
  }
  const cells = rows.map((r) => COLUMNS.map((c) => shorten(c.cell(r, now), 32)));
  const shown = COLUMNS.map((_, i) => i).filter((i) => i < 3 || cells.some((c) => c[i] !== ""));
  const widths = shown.map((i) => Math.max(COLUMNS[i].head.length, ...cells.map((c) => c[i].length)));
  const memoryAt = shown.indexOf(COLUMNS.findIndex((c) => c.head === "MEMORY"));
  const out = [chalk.bold.cyan(shown.map((i, n) => COLUMNS[i].head.padEnd(widths[n])).join("  ").trimEnd())];
  rows.forEach((r, row) => {
    const parts = shown.map((i, n) => cells[row][i].padEnd(widths[n]));
    if (memoryAt >= 0 && (r.memory ?? 0) > HIGH_MEMORY) parts[memoryAt] = chalk.red.bold(parts[memoryAt]);
    out.push(paintRow(r, parts.join("  ").trimEnd()));
  });
  out.push(chalk.dim(`${rows.length} listening port${rows.length === 1 ? "" : "s"}`));
  return out.join("\n");
}

// The full story on one port, for `ports check`. Every fact is listed, and
// anything Windows wouldn't tell us says "unavailable".
export function renderCheck(port: number, rows: PortDetails[], now = new Date()): string {
  if (rows.length === 0) return chalk.yellow(`Nothing is listening on port ${port}.`) + "\nIt's free to use.";
  const intro = rows.length > 1 ? [chalk.yellow(`${rows.length} programs are listening on port ${port}.`), ""] : [];
  const blocks = rows.map((r) => {
    const memory = formatMemory(r.memory);
    const facts: [string, string][] = [
      ["PID", String(r.pid)],
      ["Process", r.process],
      ["Command", r.command || UNAVAILABLE],
      ["Project", vexyLabel(r.port) ?? r.project?.name ?? UNAVAILABLE],
      ["Framework", frameworkLabel(r.project) || UNAVAILABLE],
      ["Directory", r.project?.dir || UNAVAILABLE],
      ["Memory", memory ? ((r.memory ?? 0) > HIGH_MEMORY ? chalk.red.bold(memory) : memory) : UNAVAILABLE],
      ["Uptime", formatUptime(r.started, now) || UNAVAILABLE],
    ];
    const lines = facts.map(([k, v]) => `  ${chalk.cyan(k.padEnd(10))} ${v === UNAVAILABLE ? chalk.dim(v) : v}`);
    const stop = isSystem(r.pid, r.process)
      ? chalk.dim("  This is part of Windows, so ports won't stop it.")
      : `  Stop it with ${chalk.green(`ports kill ${r.port}`)}`;
    return [chalk.bold(`Port ${r.port}`), ...lines, "", stop].join("\n");
  });
  return [...intro, blocks.join("\n\n")].join("\n");
}
