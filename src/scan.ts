import { execa } from "execa";

// One program waiting for connections on a TCP port.
export type Listener = { port: number; pid: number; process: string };

export class ScanError extends Error {}

// Finds every listening TCP port on this Windows computer and the program
// behind it, using the netstat and tasklist commands that come with Windows.
export async function scanPorts(): Promise<Listener[]> {
  if (process.platform !== "win32") {
    throw new ScanError(`ports works on Windows only for now (this computer runs ${process.platform}).`);
  }
  // "-p TCP" lists IPv4 only, so IPv6 is a second netstat run.
  const [netstat4, netstat6, tasklist] = await Promise.all([
    run("netstat", ["-ano", "-p", "TCP"]),
    run("netstat", ["-ano", "-p", "TCPv6"]),
    run("tasklist", ["/FO", "CSV", "/NH"]),
  ]);
  return combine(parseNetstat(netstat4 + "\n" + netstat6), parseTasklist(tasklist));
}

async function run(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execa(command, args, { windowsHide: true });
    return stdout;
  } catch (e) {
    const why = e instanceof Error ? e.message.split("\n")[0] : String(e);
    throw new ScanError(`Couldn't run ${command}: ${why}`);
  }
}

// Reads `netstat -ano` output and keeps the listening TCP sockets.
// A listening socket has no remote end yet, so its foreign address is
// 0.0.0.0:0 or [::]:0. Checking that, rather than the word LISTENING, also
// works on Windows set to other languages.
export function parseNetstat(text: string): { port: number; pid: number }[] {
  const found: { port: number; pid: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !cols[0].startsWith("TCP")) continue;
    const [, local, foreign] = cols;
    if (foreign !== "0.0.0.0:0" && foreign !== "[::]:0") continue;
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    const pid = Number(cols[cols.length - 1]);
    if (Number.isInteger(port) && port > 0 && Number.isInteger(pid)) found.push({ port, pid });
  }
  return found;
}

// Reads `tasklist /FO CSV /NH` output into a PID → program name lookup.
export function parseTasklist(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const fields = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replaceAll('""', '"'));
    if (fields.length < 2) continue;
    const pid = Number(fields[1]);
    if (Number.isInteger(pid)) names.set(pid, fields[0]);
  }
  return names;
}

// Joins ports to program names, keeping one row when a program listens on
// the same port through both IPv4 and IPv6.
export function combine(sockets: { port: number; pid: number }[], names: Map<number, string>): Listener[] {
  const rows = new Map<string, Listener>();
  for (const { port, pid } of sockets) {
    const key = `${port}/${pid}`;
    if (!rows.has(key)) rows.set(key, { port, pid, process: names.get(pid) ?? (pid === 4 ? "System" : "unknown (already closed)") });
  }
  return [...rows.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}
