import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { canStop } from "../src/actions.ts";
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
  fs.writeFileSync(path.join(app, "node_modules", "next", "package.json"), JSON.stringify({ name: "next" }));
  const bin = path.join(app, "node_modules", "next", "dist", "bin", "next");
  assert.deepEqual(findProject(`"node" "${bin}" dev`), { name: "vexy", framework: "Next.js", dir: app });
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
  project: { name: "vexy", framework: "Next.js", dir: "C:\\code\\vexy" },
};

test("the table shows project, framework, memory and uptime", () => {
  const out = plain(renderTable([NEXT], new Date("2026-10-19T12:00:00Z")));
  assert.match(out.split("\n")[0], /^PORT\s+PID\s+PROCESS\s+PROJECT\s+FRAMEWORK\s+MEMORY\s+UPTIME$/);
  assert.match(out, /3000\s+8812\s+node\.exe\s+Vexy website\s+Next\.js\s+90 MB\s+1h 0m/);
});

test("check shows everything about a port and how to stop it", () => {
  const out = plain(renderCheck(3000, [NEXT], new Date("2026-10-19T12:00:00Z")));
  for (const fact of ["Port 3000", "PID        8812", "Framework  Next.js", "Directory  C:\\code\\vexy", "Memory     90 MB", "Uptime     1h 0m", "ports kill 3000"]) {
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
