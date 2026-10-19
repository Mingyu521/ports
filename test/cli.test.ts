import assert from "node:assert/strict";
import { execFile as execFileCb, spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// These run the built command (npm run build first), like a person would.
const run = promisify(execFileCb);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("help explains the list command", async () => {
  const { stdout } = await run(process.execPath, [CLI, "list", "--help"]);
  assert.match(stdout, /listening TCP port/);
  assert.match(stdout, /Vexy website/);
});

test("finds a throwaway server and shows its port once", { skip: process.platform !== "win32" && "needs Windows" }, async () => {
  // Two sockets on one port, IPv4 and IPv6, like many dev servers open.
  const v4 = createServer().listen(0, "0.0.0.0");
  await new Promise((ok) => v4.once("listening", ok));
  const { port } = v4.address() as { port: number };
  const v6 = createServer().listen({ port, host: "::", ipv6Only: true });
  await new Promise((ok) => v6.once("listening", ok));
  try {
    const { stdout } = await run(process.execPath, [CLI, "list"], { env: { ...process.env, FORCE_COLOR: "0" } });
    const rows = stdout.split("\n").filter((l) => l.startsWith(`${port} `));
    assert.equal(rows.length, 1, `expected one row for port ${port}:\n${stdout}`);
    assert.match(rows[0], new RegExp(`^${port}\\s+${process.pid}\\s+node\\.exe`));
  } finally {
    v4.close();
    v6.close();
  }
});

test("explains clearly when it can't scan", { skip: process.platform === "win32" && "only fails off Windows" }, async () => {
  await assert.rejects(run(process.execPath, [CLI, "list"]), (e: { code: number; stderr: string }) => {
    assert.equal(e.code, 1);
    assert.match(e.stderr, /Couldn't scan ports\. ports works on Windows only/);
    return true;
  });
});

test("checks and stops a throwaway server", { skip: process.platform !== "win32" && "needs Windows" }, async () => {
  // A separate node process listening on a free port, so stopping it is safe.
  const server = spawn(process.execPath, ["-e", "const s=require('http').createServer().listen(0,()=>console.log(s.address().port))"]);
  const port = await new Promise<number>((ok) => server.stdout.once("data", (d) => ok(Number(String(d).trim()))));
  const exited = new Promise((ok) => server.once("exit", ok));
  const env = { ...process.env, FORCE_COLOR: "0" };

  const { stdout: check } = await run(process.execPath, [CLI, "check", String(port)], { env });
  assert.match(check, new RegExp(`Port ${port}`));
  assert.match(check, new RegExp(`PID\\s+${server.pid}`));
  assert.match(check, /node\.exe/);
  assert.match(check, new RegExp(`ports kill ${port}`));

  const { stdout: killed } = await run(process.execPath, [CLI, "kill", String(port), "--yes", "--force"], { env });
  assert.match(killed, new RegExp(`Stopped node\\.exe \\(PID ${server.pid}\\) on port ${port}`));
  await exited;

  // Nothing listening any more: exit code 3.
  await assert.rejects(run(process.execPath, [CLI, "check", String(port)], { env }), (e: { code: number; stdout: string }) => {
    assert.equal(e.code, 3);
    assert.match(e.stdout, new RegExp(`Nothing is listening on port ${port}`));
    return true;
  });
});

test("refuses a port number that isn't one", async () => {
  await assert.rejects(run(process.execPath, [CLI, "check", "99999"]), (e: { stderr: string }) => /port number from 1 to 65535/.test(e.stderr));
});

test("exit codes tell scripts what happened", async () => {
  const code = (args: string[]) => run(process.execPath, [CLI, ...args]).then(() => 0, (e: { code: number }) => e.code);
  assert.equal(await code(["--version"]), 0);
  assert.equal(await code(["check", "0"]), 2);
  assert.equal(await code(["check", "3000.5"]), 2);
  assert.equal(await code(["watch", "--interval", "0"]), 2);
  assert.equal(await code(["kill", "3000", "--json"]), 2); // --json needs --yes
});

test("JSON output and watch mode on a throwaway server", { skip: process.platform !== "win32" && "needs Windows" }, async () => {
  const env = { ...process.env, FORCE_COLOR: "0" };
  const watcher = spawn(process.execPath, [CLI, "watch", "--interval", "0.5", "--json"], { env });
  const lines: Record<string, unknown>[] = [];
  let buffer = "";
  watcher.stdout.on("data", (d) => {
    buffer += String(d);
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) if (line.trim()) lines.push(JSON.parse(line));
  });
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 200));
    assert.ok(ok(), `timed out; watch printed ${JSON.stringify(lines)}`);
  };
  await new Promise((r) => setTimeout(r, 3000)); // let watch take its first look

  const server = spawn(process.execPath, ["-e", "const s=require('http').createServer().listen(0,()=>console.log(s.address().port))"]);
  const port = await new Promise<number>((ok) => server.stdout.once("data", (d) => ok(Number(String(d).trim()))));
  await until(() => lines.some((l) => l.event === "started" && l.port === port && l.pid === server.pid));

  const { stdout } = await run(process.execPath, [CLI, "check", String(port), "--json"], { env });
  const checked = JSON.parse(stdout);
  assert.equal(checked.listening, true);
  assert.equal(checked.processes[0].pid, server.pid);
  assert.equal(checked.processes[0].process, "node.exe");
  assert.equal(typeof checked.processes[0].memoryBytes, "number");

  const { stdout: killed } = await run(process.execPath, [CLI, "kill", String(port), "--yes", "--force", "--json"], { env });
  assert.deepEqual(JSON.parse(killed).stopped, [{ pid: server.pid, process: "node.exe" }]);
  await until(() => lines.some((l) => l.event === "stopped" && l.port === port));
  watcher.kill();

  const free = await run(process.execPath, [CLI, "check", String(port), "--json"]).then(() => 0, (e: { code: number; stdout: string }) => {
    assert.equal(JSON.parse(e.stdout).listening, false);
    return e.code;
  });
  assert.equal(free, 3);
});
