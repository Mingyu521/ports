import { run, ScanError, type Listener } from "./scan.ts";
import { findProject, type Project } from "./project.ts";

// What Windows knows about a running program.
export type ProcessInfo = { command: string; started?: Date; memory?: number };

// A listening port plus everything we could learn about its program.
export type PortDetails = Listener & Partial<ProcessInfo> & { project?: Project };

// Asks Windows (through PowerShell) for each program's full command line,
// start time and memory. One call covers every PID.
export async function processInfo(pids: number[]): Promise<Map<number, ProcessInfo>> {
  const wanted = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 4);
  if (wanted.length === 0) return new Map();
  const filter = wanted.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const script =
    `Get-CimInstance Win32_Process -Filter '${filter}' | ` +
    "Select-Object ProcessId, CommandLine, WorkingSetSize, " +
    "@{n='Started';e={if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') }}} | " +
    "ConvertTo-Json -Compress";
  const json = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return parseProcessInfo(json);
}

// Reads PowerShell's JSON. One process comes back as an object, several as a list.
export function parseProcessInfo(json: string): Map<number, ProcessInfo> {
  const info = new Map<number, ProcessInfo>();
  if (!json.trim()) return info;
  const data: unknown = JSON.parse(json);
  for (const row of Array.isArray(data) ? data : [data]) {
    if (!row || typeof row !== "object") continue;
    const { ProcessId, CommandLine, WorkingSetSize, Started } = row as Record<string, unknown>;
    if (typeof ProcessId !== "number") continue;
    const started = typeof Started === "string" ? new Date(Started) : undefined;
    info.set(ProcessId, {
      command: typeof CommandLine === "string" ? CommandLine : "",
      started: started && !Number.isNaN(started.getTime()) ? started : undefined,
      memory: typeof WorkingSetSize === "number" ? WorkingSetSize : undefined,
    });
  }
  return info;
}

// Adds command, memory, uptime and project to each port. If PowerShell
// can't answer, the basic port list still comes back.
export async function addDetails(rows: Listener[]): Promise<PortDetails[]> {
  let info = new Map<number, ProcessInfo>();
  try {
    info = await processInfo(rows.map((r) => r.pid));
  } catch (e) {
    if (!(e instanceof ScanError || e instanceof SyntaxError)) throw e;
  }
  return rows.map((r) => {
    const extra = info.get(r.pid);
    return { ...r, ...extra, project: extra ? findProject(extra.command) : undefined };
  });
}
