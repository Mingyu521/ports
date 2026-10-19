import { execa } from "execa";
import { ScanError } from "./scan.ts";

// Programs Windows needs to keep running. Stopping them can crash the computer.
const PROTECTED = new Set(["system", "system idle process", "smss.exe", "csrss.exe", "wininit.exe", "services.exe", "lsass.exe", "winlogon.exe", "svchost.exe"]);

// Windows' own programs, shown dimmed so dev servers stand out.
export function isSystem(pid: number, process: string): boolean {
  return pid <= 4 || PROTECTED.has(process.toLowerCase());
}

// Programs using more than this much memory are shown in red.
export const HIGH_MEMORY = 500 * 1024 * 1024;

export function canStop(pid: number, process: string): string | undefined {
  if (pid <= 4) return "that's part of Windows itself";
  if (PROTECTED.has(process.toLowerCase())) return `${process} is part of Windows and stopping it can crash the computer`;
  if (pid === globalThis.process.pid) return "that's this ports command";
  return undefined;
}

// Stops a program the way closing it would. With force, also stops it if it
// won't close (taskkill /F). /T takes its child processes with it.
export async function stopProcess(pid: number, force = false): Promise<void> {
  const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
  try {
    await execa("taskkill", args, { windowsHide: true });
  } catch (e) {
    const why = (e as { stderr?: string }).stderr?.trim() || (e instanceof Error ? e.message : String(e));
    throw new ScanError(why.split("\n")[0]);
  }
}

// Opens http://localhost:<port> in the default browser.
export async function openBrowser(port: number): Promise<void> {
  await execa("cmd", ["/c", "start", "", `http://localhost:${port}`], { windowsHide: true });
}

// Opens a project folder in Cursor, else VS Code, else File Explorer.
// Their commands are .cmd files, which Windows only runs through cmd.
export async function openEditor(dir: string): Promise<string> {
  for (const [command, name] of [["cursor", "Cursor"], ["code", "VS Code"]]) {
    const { exitCode } = await execa("cmd", ["/c", command, dir], { windowsHide: true, reject: false });
    if (exitCode === 0) return name;
  }
  await execa("explorer", [dir], { windowsHide: true, reject: false });
  return "File Explorer";
}
