import chalk from "chalk";
import { vexyLabel } from "./labels.ts";
import type { Listener } from "./scan.ts";

// Turns the scan into a table. It only formats text, so it's easy to test.
export function renderTable(rows: Listener[]): string {
  if (rows.length === 0) {
    return chalk.yellow("No ports are listening right now.") + "\nStart a server (for example `npm run dev`) and run `ports list` again.";
  }
  const cells = rows.map((r) => [String(r.port), String(r.pid), r.process, vexyLabel(r.port) ?? ""]);
  const head = ["PORT", "PID", "PROCESS", "VEXY"];
  const showVexy = cells.some((c) => c[3] !== "");
  const cols = showVexy ? 4 : 3;
  const widths = head.slice(0, cols).map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c: string[]) => c.slice(0, cols).map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd();
  const out = [chalk.bold.cyan(line(head))];
  for (const c of cells) {
    const text = line(c);
    out.push(c[3] ? chalk.magenta(text) : text);
  }
  out.push(chalk.dim(`${rows.length} listening port${rows.length === 1 ? "" : "s"}`));
  return out.join("\n");
}
