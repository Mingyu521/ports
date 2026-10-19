import { isSystem } from "./actions.ts";
import type { PortDetails } from "./details.ts";
import { vexyLabel } from "./labels.ts";

// The shape `--json` prints, stable for scripts and AI agents to read.
export type PortJson = {
  port: number;
  pid: number;
  process: string;
  command: string | null;
  memoryBytes: number | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  system: boolean;
  vexy: string | null;
  project: { name: string; framework: string | null; frameworkVersion: string | null; dir: string } | null;
};

export function toJson(r: PortDetails, now = new Date()): PortJson {
  return {
    port: r.port,
    pid: r.pid,
    process: r.process,
    command: r.command || null,
    memoryBytes: r.memory ?? null,
    startedAt: r.started?.toISOString() ?? null,
    uptimeSeconds: r.started ? Math.max(0, Math.floor((now.getTime() - r.started.getTime()) / 1000)) : null,
    system: isSystem(r.pid, r.process),
    vexy: vexyLabel(r.port) ?? null,
    project: r.project
      ? { name: r.project.name, framework: r.project.framework ?? null, frameworkVersion: r.project.frameworkVersion ?? null, dir: r.project.dir }
      : null,
  };
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
