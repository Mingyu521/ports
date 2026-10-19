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

  const { stdout: after } = await run(process.execPath, [CLI, "check", String(port)], { env });
  assert.match(after, new RegExp(`Nothing is listening on port ${port}`));
});

test("refuses a port number that isn't one", async () => {
  await assert.rejects(run(process.execPath, [CLI, "check", "99999"]), (e: { stderr: string }) => /port number from 1 to 65535/.test(e.stderr));
});
