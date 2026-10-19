import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { combine, parseNetstat, parseTasklist } from "../src/scan.ts";
import { renderTable } from "../src/table.ts";

// Real netstat -ano output shapes, IPv4 and IPv6, with connections that are
// not listening mixed in.
const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1032
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       8812
  TCP    127.0.0.1:54322        0.0.0.0:0              LISTENING       5120
  TCP    192.168.1.20:52144     140.82.112.4:443       ESTABLISHED     9001
  TCP    [::]:135               [::]:0                 LISTENING       1032
  TCP    [::]:3000              [::]:0                 LISTENING       8812
  TCP    [::1]:5432             [::]:0                 ABHÖREN         7777
  TCP    [::1]:52150            [::1]:3000             ESTABLISHED     9001
  UDP    0.0.0.0:5353           *:*                                    2200
`;

const TASKLIST = `"System Idle Process","0","Services","0","8 K"
"System","4","Services","0","144 K"
"svchost.exe","1032","Services","0","12,340 K"
"node.exe","8812","Console","1","88,120 K"
"com.docker.backend.exe","5120","Console","1","40,000 K"
"My ""quoted"" app.exe","7777","Console","1","1,000 K"`;

test("keeps only listening TCP sockets, in any Windows language", () => {
  assert.deepEqual(parseNetstat(NETSTAT), [
    { port: 135, pid: 1032 },
    { port: 3000, pid: 8812 },
    { port: 54322, pid: 5120 },
    { port: 135, pid: 1032 },
    { port: 3000, pid: 8812 },
    { port: 5432, pid: 7777 },
  ]);
});

test("reads program names from tasklist, quotes and all", () => {
  const names = parseTasklist(TASKLIST);
  assert.equal(names.get(8812), "node.exe");
  assert.equal(names.get(7777), 'My "quoted" app.exe');
  assert.equal(names.size, 6);
});

test("shows a port once when a program listens on IPv4 and IPv6", () => {
  const rows = combine(parseNetstat(NETSTAT), parseTasklist(TASKLIST));
  assert.deepEqual(
    rows.map((r) => `${r.port} ${r.pid} ${r.process}`),
    ["135 1032 svchost.exe", "3000 8812 node.exe", "5432 7777 My \"quoted\" app.exe", "54322 5120 com.docker.backend.exe"],
  );
});

test("names programs that closed between the two scans", () => {
  assert.equal(combine([{ port: 8080, pid: 999 }], new Map())[0].process, "unknown (already closed)");
});

test("the table labels Vexy's ports and counts the rows", () => {
  const out = plain(renderTable(combine(parseNetstat(NETSTAT), parseTasklist(TASKLIST))));
  const lines = out.split("\n");
  assert.match(lines[0], /^PORT\s+PID\s+PROCESS\s+PROJECT$/);
  assert.match(out, /3000\s+8812\s+node\.exe\s+Vexy website/);
  assert.match(out, /54322\s+5120\s+com\.docker\.backend\.exe\s+Vexy database/);
  assert.match(lines.at(-1)!, /4 listening ports/);
});

test("the table leaves out empty columns", () => {
  const out = plain(renderTable([{ port: 135, pid: 1032, process: "svchost.exe" }]));
  assert.match(out.split("\n")[0], /^PORT\s+PID\s+PROCESS$/);
  assert.match(out, /1 listening port$/);
});

test("an empty scan explains what to do", () => {
  assert.match(plain(renderTable([])), /No ports are listening right now/);
});
