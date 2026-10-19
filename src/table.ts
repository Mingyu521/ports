import chalk from "chalk";
import type { PortDetails } from "./details.ts";
import { formatMemory, formatUptime, shorten } from "./format.ts";
import { vexyLabel } from "./labels.ts";

type Column = { head: string; cell: (r: PortDetails) => string };

const COLUMNS: Column[] = [
  { head: "PORT", cell: (r) => String(r.port) },
  { head: "PID", cell: (r) => String(r.pid) },
  { head: "PROCESS", cell: (r) => r.process },
  { head: "PROJECT", cell: (r) => vexyLabel(r.port) ?? r.project?.name ?? "" },
  { head: "FRAMEWORK", cell: (r) => r.project?.framework ?? "" },
  { head: "MEMORY", cell: (r) => formatMemory(r.memory) },
  { head: "UPTIME", cell: (r) => formatUptime(r.started) },
];

// Turns the scan into a table. It only formats text, so it's easy to test.
// Columns with nothing in them are left out.
export function renderTable(rows: PortDetails[], now = new Date()): string {
  if (rows.length === 0) {
    return chalk.yellow("No ports are listening right now.") + "\nStart a server (for example `npm run dev`) and run `ports list` again.";
  }
  const columns = COLUMNS.map((c) => (c.head === "UPTIME" ? { ...c, cell: (r: PortDetails) => formatUptime(r.started, now) } : c));
  const cells = rows.map((r) => columns.map((c) => shorten(c.cell(r), 32)));
  const shown = columns.map((_, i) => i).filter((i) => i < 3 || cells.some((c) => c[i] !== ""));
  const widths = shown.map((i) => Math.max(columns[i].head.length, ...cells.map((c) => c[i].length)));
  const line = (c: string[]) => shown.map((i, n) => c[i].padEnd(widths[n])).join("  ").trimEnd();
  const out = [chalk.bold.cyan(line(columns.map((c) => c.head)))];
  rows.forEach((r, n) => out.push(vexyLabel(r.port) ? chalk.magenta(line(cells[n])) : line(cells[n])));
  out.push(chalk.dim(`${rows.length} listening port${rows.length === 1 ? "" : "s"}`));
  return out.join("\n");
}

// The full story on one port, for `ports check`.
export function renderCheck(port: number, rows: PortDetails[], now = new Date()): string {
  if (rows.length === 0) return chalk.yellow(`Nothing is listening on port ${port}.`) + "\nIt's free to use.";
  return rows
    .map((r) => {
      const facts: [string, string][] = [
        ["PID", String(r.pid)],
        ["Process", r.process],
        ["Command", r.command ?? ""],
        ["Project", vexyLabel(r.port) ?? r.project?.name ?? ""],
        ["Framework", r.project?.framework ?? ""],
        ["Directory", r.project?.dir ?? ""],
        ["Memory", formatMemory(r.memory)],
        ["Uptime", formatUptime(r.started, now)],
      ];
      const lines = facts.filter(([, v]) => v).map(([k, v]) => `  ${chalk.cyan(k.padEnd(10))} ${v}`);
      return [chalk.bold(`Port ${r.port}`), ...lines, "", `  Stop it with ${chalk.green(`ports kill ${r.port}`)}`].join("\n");
    })
    .join("\n\n");
}
