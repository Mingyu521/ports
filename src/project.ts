import fs from "node:fs";
import path from "node:path";

// The code project a program was started from, worked out from its command line.
export type Project = { name: string; framework?: string; frameworkVersion?: string; dir: string };

// "Next.js 16.3.8", or just "Next.js" when the version is unknown.
export function frameworkLabel(project?: Project): string {
  if (!project?.framework) return "";
  return project.frameworkVersion ? `${project.framework} ${project.frameworkVersion}` : project.framework;
}

// Dependencies that tell us which framework a project uses, most specific first.
const FRAMEWORKS: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@sveltejs/kit", "SvelteKit"],
  ["@remix-run/dev", "Remix"],
  ["astro", "Astro"],
  ["@angular/core", "Angular"],
  ["react-scripts", "Create React App"],
  ["@nestjs/core", "NestJS"],
  ["vite", "Vite"],
  ["fastify", "Fastify"],
  ["express", "Express"],
  ["supabase", "Supabase"],
];

// Finds a project folder from paths in the command line, like
// "C:\code\vexy\node_modules\next\dist\bin\next" dev → C:\code\vexy.
export function findProject(command: string): Project | undefined {
  for (const candidate of pathsIn(command)) {
    const dir = projectDir(candidate);
    if (dir) return describe(dir, command);
  }
  return pythonProject(command);
}

// Absolute paths inside a command line, quoted or not.
export function pathsIn(command: string): string[] {
  const found: string[] = [];
  for (const m of command.matchAll(/"([^"]+)"|(\S+)/g)) {
    const token = m[1] ?? m[2];
    if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith("/")) found.push(token);
  }
  return found;
}

// Walks up from a path to the nearest folder with a package.json, stepping
// out of node_modules first so we find the app, not a library inside it.
function projectDir(start: string): string | undefined {
  const cut = start.search(/[\\/]node_modules[\\/]/);
  let dir = cut >= 0 ? start.slice(0, cut) : start;
  for (let i = 0; i < 12; i++) {
    if (exists(path.join(dir, "package.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
  return undefined;
}

function describe(dir: string, command: string): Project {
  let pkg: { name?: unknown; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    // An unreadable package.json still tells us where the project is.
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const match = FRAMEWORKS.find(([dep]) => dep in deps && command.toLowerCase().includes(dep.split("/").pop()!))
    ?? FRAMEWORKS.find(([dep]) => dep in deps);
  const name = typeof pkg.name === "string" && pkg.name ? pkg.name : path.basename(dir);
  if (!match) return { name, dir };
  const [dep, framework] = match;
  return { name, framework, frameworkVersion: installedVersion(dir, dep) ?? declaredVersion(deps[dep]), dir };
}

// The version actually installed in node_modules, like 16.3.8.
function installedVersion(dir: string, dep: string): string | undefined {
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(dir, "node_modules", dep, "package.json"), "utf8"));
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

// Falls back to package.json's range, like "^16.3.0" → 16.3.0.
function declaredVersion(range: unknown): string | undefined {
  const m = typeof range === "string" ? range.match(/\d+(\.\d+){0,2}/) : null;
  return m?.[0];
}

// Python dev servers say what they are in the command itself.
function pythonProject(command: string): Project | undefined {
  const lower = command.toLowerCase();
  const framework = lower.includes("manage.py") ? "Django"
    : lower.includes("uvicorn") ? "FastAPI"
    : lower.includes("flask") ? "Flask"
    : undefined;
  if (!framework) return undefined;
  const script = pathsIn(command).find((p) => /\.py$/i.test(p));
  const dir = script ? path.dirname(script) : "";
  return { name: dir ? path.basename(dir) : framework, framework, dir };
}

function exists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
