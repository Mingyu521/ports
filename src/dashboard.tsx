import chalk from "chalk";
import { Box, render, Text, useAnimation, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { canStop, HIGH_MEMORY, isSystem } from "./actions.ts";
import type { PortDetails } from "./details.ts";
import { formatMemory, formatUptime, shorten } from "./format.ts";
import { vexyLabel } from "./labels.ts";
import { frameworkLabel } from "./project.ts";
import { diff } from "./watch.ts";

// Frutiger Aero colors: sky, aqua, glass and fresh green.
const SKY = "#0a84c6";
const AQUA = "#5fd4ff";
const GLASS = "#d9f4ff";
const GRASS = "#7ddc5a";
const MINT = "#5fe3c1";

export type Actions = {
  stop: (pid: number, force: boolean) => Promise<void>;
  openBrowser: (port: number) => Promise<void>;
  openEditor: (dir: string) => Promise<string>;
};

export type DashboardProps = {
  scan: () => Promise<PortDetails[]>;
  actions: Actions;
  refreshMs?: number;
  // Called when a program starts listening on a new port (the CLI rings the terminal bell).
  onNewPort?: () => void;
};

const FILTERS = ["all", "projects", "vexy"] as const;
const FILTER_NAMES = { all: "All", projects: "Dev servers", vexy: "Vexy" };
const SORTS = ["port", "memory", "uptime", "project"] as const;
const SORT_NAMES = { port: "Port", memory: "Memory", uptime: "Uptime", project: "Project" };

type Mode = { kind: "browse" } | { kind: "search" } | { kind: "confirm"; row: PortDetails };

// The live dashboard: every listening port, refreshed every few seconds,
// with keys to stop, open and filter them.
export function Dashboard({ scan, actions, refreshMs = 3000, onNewPort }: DashboardProps) {
  const { exit } = useApp();
  const [rows, setRows] = useState<PortDetails[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]>("port");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>({ kind: "browse" });
  const busy = useRef(false);
  const last = useRef<PortDetails[] | null>(null);

  // Returns true when it announced a new port, so "Refreshed." doesn't cover it up.
  const refresh = useCallback(async (): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    try {
      const next = await scan();
      // After the first scan, tell the person about programs that just started listening.
      const started = last.current ? diff(last.current, next).filter((c) => c.event === "started") : [];
      if (started.length) {
        setNote(`New: ${started.map((c) => `${c.row.process} on ${c.row.port}`).join(", ")}`);
        onNewPort?.();
      }
      last.current = next;
      setRows(next);
      setError("");
      return started.length > 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      busy.current = false;
    }
  }, [scan, onNewPort]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), refreshMs);
    return () => clearInterval(timer);
  }, [refresh, refreshMs]);

  const visible = arrange(rows ?? [], filter, sort, search);
  const current = visible[Math.min(selected, visible.length - 1)];

  const act = async (label: string, work: () => Promise<void>) => {
    try {
      await work();
      setNote(label);
    } catch (e) {
      setNote(`Couldn't do that: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useInput((input, key) => {
    if (mode.kind === "search") {
      if (key.return) setMode({ kind: "browse" });
      else if (key.escape) {
        setSearch("");
        setMode({ kind: "browse" });
      } else if (key.backspace || key.delete) setSearch((s) => s.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setSearch((s) => s + input);
      setSelected(0);
      return;
    }
    if (mode.kind === "confirm") {
      const { row } = mode;
      setMode({ kind: "browse" });
      if (input === "y" || input === "F") {
        const force = input === "F";
        void act(`Stopped ${row.process} on port ${row.port}.`, () => actions.stop(row.pid, force)).then(refresh);
      } else setNote("Left it running.");
      return;
    }
    if (input === "q" || key.escape) exit();
    else if (key.upArrow) setSelected((n) => Math.max(0, n - 1));
    else if (key.downArrow) setSelected((n) => Math.min(visible.length - 1, n + 1));
    else if (input === "r") void refresh().then((announced) => !announced && setNote("Refreshed."));
    else if (input === "f") {
      setFilter((f) => FILTERS[(FILTERS.indexOf(f) + 1) % FILTERS.length]);
      setSelected(0);
    } else if (input === "s") setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]);
    else if (input === "/") setMode({ kind: "search" });
    else if (!current) return;
    else if (input === "k" || input === "K") {
      const why = canStop(current.pid, current.process);
      if (why) setNote(`Won't stop PID ${current.pid}: ${why}.`);
      else setMode({ kind: "confirm", row: current });
    } else if (input === "o") void act(`Opened http://localhost:${current.port}`, () => actions.openBrowser(current.port));
    else if (input === "e") {
      const dir = current.project?.dir;
      if (dir) {
        actions.openEditor(dir).then(
          (editor) => setNote(`Opened ${dir} in ${editor}.`),
          (e) => setNote(`Couldn't open the folder: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
      else setNote("No project folder found for this program.");
    }
  });

  return (
    <Box flexDirection="column">
      <Header count={rows?.length} />
      {error ? <Text color="red">Couldn't scan ports. {error}</Text> : null}
      {rows === null ? (
        <Text color={AQUA}>Calvin is looking around…</Text>
      ) : visible.length === 0 ? (
        <Text color={AQUA}>{rows.length === 0 ? "No ports are listening. ᓚᘏᗢ Calvin is napping." : "Nothing matches. Press f or / to change what's shown."}</Text>
      ) : (
        <PortTable rows={visible} selected={visible.indexOf(current)} />
      )}
      <Box marginTop={1}>
        {mode.kind === "confirm" ? (
          <Text color="yellow">
            Stop {mode.row.process} (PID {mode.row.pid}) on port {mode.row.port}?  <Text bold>y</Text> stop  <Text bold>F</Text> force stop  <Text bold>n</Text> cancel
          </Text>
        ) : mode.kind === "search" ? (
          <Text color={AQUA}>Search: {search}<Text inverse> </Text>  (Enter to keep, Esc to clear)</Text>
        ) : (
          <Text color={GRASS}>{note}</Text>
        )}
      </Box>
      <Keys filter={FILTER_NAMES[filter]} sort={SORT_NAMES[sort]} search={search} />
    </Box>
  );
}

// Glassy title bar with bubbles drifting up past Calvin.
function Header({ count }: { count?: number }) {
  const { frame } = useAnimation({ interval: 500 });
  const bubbles = ["◦", "°", "○", "◦", "·"];
  const drift = (offset: number) => bubbles[(frame + offset) % bubbles.length];
  return (
    <Box borderStyle="round" borderColor={AQUA} paddingX={1} alignSelf="flex-start">
      <Text>
        <Text color={AQUA}>{drift(0)} {drift(2)} {drift(4)} </Text>
        {gradient("ports", [SKY, AQUA, MINT, GRASS])}
        <Text color={GLASS}>  ᓚᘏᗢ Calvin is watching {count === undefined ? "…" : `${count} port${count === 1 ? "" : "s"}`} </Text>
        <Text color={AQUA}>{drift(3)} {drift(1)} {drift(4)}</Text>
      </Text>
    </Box>
  );
}

const COLUMNS: [string, number, (r: PortDetails) => string][] = [
  ["PORT", 6, (r) => String(r.port)],
  ["PID", 7, (r) => String(r.pid)],
  ["PROCESS", 18, (r) => r.process],
  ["PROJECT", 18, (r) => vexyLabel(r.port) ?? r.project?.name ?? ""],
  ["FRAMEWORK", 18, (r) => frameworkLabel(r.project)],
  ["MEMORY", 9, (r) => formatMemory(r.memory)],
  ["UPTIME", 9, (r) => formatUptime(r.started)],
];

function PortTable({ rows, selected }: { rows: PortDetails[]; selected: number }) {
  const line = (cells: string[]) => cells.map((c, i) => shorten(c, COLUMNS[i][1] - 1).padEnd(COLUMNS[i][1])).join("");
  return (
    <Box flexDirection="column">
      <Text bold color={SKY} backgroundColor={GLASS}>{"  " + line(COLUMNS.map(([h]) => h))}</Text>
      {rows.map((r, i) => {
        const text = line(COLUMNS.map(([, , cell]) => cell(r)));
        const vexy = vexyLabel(r.port) !== undefined;
        const heavy = (r.memory ?? 0) > HIGH_MEMORY;
        if (i === selected) {
          return <Text key={`${r.port}/${r.pid}`} color="white" backgroundColor={heavy ? "#c62828" : SKY} bold>{"› " + text}</Text>;
        }
        // Windows' own programs are dimmed; anything using over 500 MB is red.
        return (
          <Text key={`${r.port}/${r.pid}`} color={heavy ? "red" : vexy ? MINT : undefined} dimColor={!heavy && isSystem(r.pid, r.process)}>
            {"  " + text}
          </Text>
        );
      })}
    </Box>
  );
}

function Keys({ filter, sort, search }: { filter: string; sort: string; search: string }) {
  const key = (k: string, label: string) => (
    <Text key={k}>
      <Text color="black" backgroundColor={AQUA}> {k} </Text>
      <Text color={GLASS}> {label} </Text>
    </Text>
  );
  return (
    <Box flexWrap="wrap">
      {key("K", "Kill")}
      {key("o", "Browser")}
      {key("e", "Editor")}
      {key("f", `Filter: ${filter}`)}
      {key("s", `Sort: ${sort}`)}
      {key("/", search ? `Search: ${search}` : "Search")}
      {key("r", "Refresh")}
      {key("q", "Quit")}
    </Box>
  );
}

// Applies the filter, search and sort the person picked.
export function arrange(rows: PortDetails[], filter: (typeof FILTERS)[number], sort: (typeof SORTS)[number], search: string): PortDetails[] {
  const needle = search.toLowerCase();
  return rows
    .filter((r) => filter === "all" || (filter === "vexy" ? vexyLabel(r.port) !== undefined : r.project !== undefined || vexyLabel(r.port) !== undefined))
    .filter((r) => !needle || [r.port, r.pid, r.process, r.command, r.project?.name, r.project?.framework, vexyLabel(r.port)].some((v) => String(v ?? "").toLowerCase().includes(needle)))
    .sort((a, b) =>
      sort === "memory" ? (b.memory ?? 0) - (a.memory ?? 0)
      : sort === "uptime" ? (a.started?.getTime() ?? Infinity) - (b.started?.getTime() ?? Infinity)
      : sort === "project" ? projectName(a).localeCompare(projectName(b)) || a.port - b.port
      : a.port - b.port || a.pid - b.pid,
    );
}

// Sorts named projects first, A to Z, then everything else.
function projectName(r: PortDetails): string {
  return vexyLabel(r.port) ?? r.project?.name ?? "\uffff";
}

function gradient(text: string, colors: string[]): string {
  return [...text].map((ch, i) => chalk.bold.hex(colors[Math.round((i / Math.max(1, text.length - 1)) * (colors.length - 1))])(ch)).join("");
}

export async function runDashboard(props: DashboardProps): Promise<void> {
  const app = render(<Dashboard {...props} />);
  await app.waitUntilExit();
}
