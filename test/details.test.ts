import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import chalk from "chalk";
import { canStop } from "../src/actions.ts";
import { toJson } from "../src/json.ts";
import { changeJson, describeChange, diff } from "../src/watch.ts";
import { parseProcessInfo } from "../src/details.ts";
import { formatMemory, formatUptime } from "../src/format.ts";
import { findProject, pathsIn } from "../src/project.ts";
import { renderCheck, renderTable } from "../src/table.ts";

test("reads PowerShell's answer for one process or many", () => {
  const one = parseProcessInfo('{"ProcessId":8812,"CommandLine":"node server.js","WorkingSetSize":94371840,"Started":"2026-10-19T01:00:00.0000000Z"}');
  assert.equal(one.get(8812)?.command, "node server.js");
  assert.equal(one.get(8812)?.memory, 94371840);
  assert.equal(one.get(8812)?.started?.toISOString(), "2026-10-19T01:00:00.000Z");
  const many = parseProcessInfo('[{"ProcessId":1,"CommandLine":null,"WorkingSetSize":10,"Started":null},{"ProcessId":2,"CommandLine":"x","WorkingSetSize":20,"Started":"bad"}]');
  assert.equal(many.get(1)?.command, "");
  assert.equal(many.get(2)?.started, undefined);
  assert.equal(parseProcessInfo("").size, 0);
});

test("finds paths in a command line, quoted or not", () => {
  assert.deepEqual(pathsIn('"C:\\Program Files\\nodejs\\node.exe" C:\\code\\vexy\\server.js --port 3000'), [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\code\\vexy\\server.js",
  ]);
});

test("works out the project and framework from the command line", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ports-"));
  const app = path.join(root, "vexy");
  fs.mkdirSync(path.join(app, "node_modules", "next", "dist", "bin"), { recursive: true });
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "vexy", dependencies: { next: "16", react: "19" } }));
  fs.writeFileSync(path.join(app, "node_modules", "next", "package.json"), JSON.stringify({ name: "next", version: "16.3.8" }));
  const bin = path.join(app, "node_modules", "next", "dist", "bin", "next");
  assert.deepEqual(findProject(`"node" "${bin}" dev`), { name: "vexy", framework: "Next.js", frameworkVersion: "16.3.8", dir: app });
  // Without node_modules, the version comes from package.json's range.
  fs.rmSync(path.join(app, "node_modules"), { recursive: true });
  assert.equal(findProject(`node ${path.join(app, "server.js")}`)?.frameworkVersion, "16");
  fs.rmSync(root, { recursive: true });
});

test("knows Python dev servers and gives up quietly on the rest", () => {
  assert.equal(findProject("python manage.py runserver")?.framework, "Django");
  assert.equal(findProject("svchost.exe -k netsvcs"), undefined);
});

test("formats memory and uptime for people", () => {
  assert.equal(formatMemory(94371840), "90 MB");
  assert.equal(formatMemory(3 * 1024 ** 3), "3.0 GB");
  const now = new Date("2026-10-19T12:00:00Z");
  assert.equal(formatUptime(new Date("2026-10-19T11:59:30Z"), now), "just now");
  assert.equal(formatUptime(new Date("2026-10-19T09:48:00Z"), now), "2h 12m");
  assert.equal(formatUptime(new Date("2026-10-16T08:00:00Z"), now), "3d 4h");
});

const NEXT = {
  port: 3000,
  pid: 8812,
  process: "node.exe",
  command: "node C:\\code\\vexy\\node_modules\\next\\dist\\bin\\next dev",
  memory: 94371840,
  started: new Date("2026-10-19T11:00:00Z"),
  project: { name: "vexy", framework: "Next.js", frameworkVersion: "16.3.8", dir: "C:\\code\\vexy" },
};

test("the table shows project, framework, memory and uptime", () => {
  const out = plain(renderTable([NEXT], new Date("2026-10-19T12:00:00Z")));
  assert.match(out.split("\n")[0], /^PORT\s+PID\s+PROCESS\s+PROJECT\s+FRAMEWORK\s+MEMORY\s+UPTIME$/);
  assert.match(out, /3000\s+8812\s+node\.exe\s+Vexy website\s+Next\.js 16\.3\.8\s+90 MB\s+1h 0m/);
});

test("check shows everything about a port and how to stop it", () => {
  const out = plain(renderCheck(3000, [NEXT], new Date("2026-10-19T12:00:00Z")));
  for (const fact of ["Port 3000", "PID        8812", "Framework  Next.js 16.3.8", "Directory  C:\\code\\vexy", "Memory     90 MB", "Uptime     1h 0m", "ports kill 3000"]) {
    assert.ok(out.includes(fact), `missing "${fact}" in:\n${out}`);
  }
  assert.match(plain(renderCheck(4321, [])), /Nothing is listening on port 4321/);
});

test("never offers to stop parts of Windows", () => {
  assert.ok(canStop(4, "System"));
  assert.ok(canStop(900, "svchost.exe"));
  assert.ok(canStop(process.pid, "node.exe"));
  assert.equal(canStop(8812, "node.exe"), undefined);
});

test("check marks missing details unavailable and handles several listeners", () => {
  const gone = { port: 8080, pid: 999, process: "unknown (already closed)" };
  const other = { port: 8080, pid: 1000, process: "python.exe", command: "python -m http.server 8080", memory: 600 * 1024 * 1024 };
  const out = plain(renderCheck(8080, [gone, other]));
  assert.match(out, /2 programs are listening on port 8080/);
  assert.match(out, /Process\s+unknown \(already closed\)/);
  for (const fact of ["Command", "Project", "Framework", "Directory", "Memory", "Uptime"]) {
    assert.match(out, new RegExp(`${fact}\\s+unavailable`), `${fact} should be unavailable for the closed program`);
  }
  assert.match(out, /Command\s+python -m http\.server 8080/);
});

test("dims Windows' own programs and shows big memory in red", () => {
  const chalkLevel = chalk.level;
  chalk.level = 1;
  try {
    const out = renderTable([
      { port: 135, pid: 1032, process: "svchost.exe", memory: 10e6 },
      { port: 5000, pid: 77, process: "java.exe", memory: 900 * 1024 * 1024 },
    ]);
    const [, system, heavy] = out.split("\n");
    assert.ok(system.startsWith("\u001B[2m"), "svchost row is dim");
    assert.ok(heavy.includes("\u001B[31m\u001B[1m900 MB"), "900 MB is red");
  } finally {
    chalk.level = chalkLevel;
  }
});

test("JSON output has every field, with null for missing details", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  assert.deepEqual(toJson(NEXT, now), {
    port: 3000,
    pid: 8812,
    process: "node.exe",
    command: NEXT.command,
    memoryBytes: 94371840,
    startedAt: "2026-10-19T11:00:00.000Z",
    uptimeSeconds: 3600,
    system: false,
    vexy: "Vexy website",
    project: { name: "vexy", framework: "Next.js", frameworkVersion: "16.3.8", dir: "C:\\code\\vexy" },
  });
  const bare = toJson({ port: 135, pid: 4, process: "System" }, now);
  assert.equal(bare.system, true);
  assert.equal(bare.command, null);
  assert.equal(bare.project, null);
});

test("watch spots programs that start and stop listening", () => {
  const a = { port: 3000, pid: 1, process: "node.exe" };
  const b = { port: 5173, pid: 2, process: "node.exe", project: { name: "shop", framework: "Vite", frameworkVersion: "7.1.0", dir: "C:\\shop" } };
  const changes = diff([a], [b]);
  assert.deepEqual(changes.map((c) => `${c.event} ${c.row.port}`), ["stopped 3000", "started 5173"]);
  const at = new Date("2026-10-19T14:02:11Z");
  assert.match(plain(describeChange(changes[1], at)), /\] \+ node\.exe \(PID 2\) started listening on 5173 · shop, Vite 7\.1\.0$/);
  assert.deepEqual(JSON.parse(changeJson(changes[0], at)).event, "stopped");
  assert.equal(JSON.parse(changeJson(changes[0], at)).time, "2026-10-19T14:02:11.000Z");
});
