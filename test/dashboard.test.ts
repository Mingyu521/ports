import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { createElement } from "react";
import { render } from "ink-testing-library";
// The dashboard is JSX, so the tests use the built copy (npm run build first).
import { arrange, Dashboard } from "../dist/dashboard.js";

const rows = [
  { port: 135, pid: 1032, process: "svchost.exe", memory: 10e6 },
  { port: 3000, pid: 8812, process: "node.exe", memory: 90e6, project: { name: "vexy", framework: "Next.js", dir: "C:\\code\\vexy" } },
  { port: 5173, pid: 7001, process: "node.exe", memory: 50e6, project: { name: "shop", framework: "Vite", dir: "C:\\code\\shop" } },
];
const tick = () => new Promise((ok) => setTimeout(ok, 50));

test("filters, searches and sorts", () => {
  assert.deepEqual(arrange(rows, "projects", "port", "").map((r) => r.port), [3000, 5173]);
  assert.deepEqual(arrange(rows, "vexy", "port", "").map((r) => r.port), [3000]);
  assert.deepEqual(arrange(rows, "all", "memory", "").map((r) => r.port), [3000, 5173, 135]);
  assert.deepEqual(arrange(rows, "all", "port", "vite").map((r) => r.port), [5173]);
});

test("the dashboard lists ports and stops one after asking", async () => {
  const stopped: [number, boolean][] = [];
  const opened: number[] = [];
  const actions = {
    stop: async (pid: number, force: boolean) => void stopped.push([pid, force]),
    openBrowser: async (port: number) => void opened.push(port),
    openEditor: async () => {},
  };
  const app = render(createElement(Dashboard, { scan: async () => rows, actions, refreshMs: 60_000 }));
  await tick();
  let frame = plain(app.lastFrame() ?? "");
  assert.match(frame, /Calvin is watching 3 ports/);
  assert.match(frame, /› 135\s+1032\s+svchost\.exe/);
  assert.match(frame, /3000\s+8812\s+node\.exe\s+Vexy website\s+Next\.js/);

  app.stdin.write("k"); // svchost is part of Windows
  await tick();
  assert.match(plain(app.lastFrame() ?? ""), /Won't stop PID 1032/);

  app.stdin.write("\u001B[B"); // down arrow to port 3000
  await tick();
  app.stdin.write("o");
  await tick();
  assert.deepEqual(opened, [3000]);

  app.stdin.write("K");
  await tick();
  assert.match(plain(app.lastFrame() ?? ""), /Stop node\.exe \(PID 8812\) on port 3000\?/);
  app.stdin.write("y");
  await tick();
  assert.deepEqual(stopped, [[8812, false]]);
  assert.match(plain(app.lastFrame() ?? ""), /Stopped node\.exe on port 3000/);

  app.stdin.write("f");
  await tick();
  frame = plain(app.lastFrame() ?? "");
  assert.match(frame, /Filter: Dev servers/);
  assert.doesNotMatch(frame, /svchost/);
  app.unmount();
});
