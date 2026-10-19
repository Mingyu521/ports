import chalk from "chalk";
import type { PortDetails } from "./details.ts";
import { toJson } from "./json.ts";
import { frameworkLabel } from "./project.ts";

export type Change = { event: "started" | "stopped"; row: PortDetails };

const key = (r: PortDetails) => `${r.port}/${r.pid}`;

// What changed between two scans: programs that started or stopped listening.
export function diff(before: PortDetails[], after: PortDetails[]): Change[] {
  const old = new Map(before.map((r) => [key(r), r]));
  const now = new Map(after.map((r) => [key(r), r]));
  return [
    ...after.filter((r) => !old.has(key(r))).map((row) => ({ event: "started" as const, row })),
    ...before.filter((r) => !now.has(key(r))).map((row) => ({ event: "stopped" as const, row })),
  ].sort((a, b) => a.row.port - b.row.port);
}

// One log line, like "[14:02:11] + node.exe (PID 8812) started listening on 3000 · vexy, Next.js 16.3.8".
export function describeChange({ event, row }: Change, at: Date): string {
  const time = chalk.dim(`[${at.toLocaleTimeString("en-GB")}]`);
  const project = row.project ? ` · ${[row.project.name, frameworkLabel(row.project)].filter(Boolean).join(", ")}` : "";
  const text = `${row.process} (PID ${row.pid}) ${event} listening on ${row.port}${project}`;
  return event === "started" ? `${time} ${chalk.green("+")} ${text}` : `${time} ${chalk.red("-")} ${chalk.dim(text)}`;
}

// One line of JSON per change, so tools can read the log as it grows.
export function changeJson({ event, row }: Change, at: Date): string {
  return JSON.stringify({ time: at.toISOString(), event, ...toJson(row, at) });
}

// Scans every `seconds` and reports each change until stopped with Ctrl+C.
export async function watch(scan: () => Promise<PortDetails[]>, seconds: number, report: (c: Change, at: Date) => void, onStart?: (rows: PortDetails[]) => void, signal?: AbortSignal): Promise<void> {
  let last = await scan();
  onStart?.(last);
  while (!signal?.aborted) {
    await new Promise((ok) => setTimeout(ok, seconds * 1000));
    if (signal?.aborted) break;
    const next = await scan();
    const at = new Date();
    for (const change of diff(last, next)) report(change, at);
    last = next;
  }
}
