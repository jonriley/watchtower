import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

type LoginProbe = {
  /** Resolved arena binary from the user shell, if any. */
  arena: string | null;
  /** PATH from login + interactive shell (matches Terminal more than GUI apps). */
  path: string;
};

let probeMemo: LoginProbe | undefined;

function shellProbeEnv(): NodeJS.ProcessEnv {
  const home = homedir();
  const bootstrapPath =
    process.platform === "darwin"
      ? "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
      : "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return {
    ...process.env,
    HOME: home,
    USER: process.env.USER ?? "",
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "",
    TERM: "dumb",
    PATH: bootstrapPath,
  };
}

function parseWatchtowerProbeLines(raw: string): LoginProbe {
  const pathMatches = [...raw.matchAll(/^WATCHTOWER_PATH=(.*)$/gm)];
  const arenaMatches = [...raw.matchAll(/^WATCHTOWER_ARENA=(.*)$/gm)];
  const pathLine = pathMatches[pathMatches.length - 1]?.[1]?.trim() ?? "";
  const arenaLine = arenaMatches[arenaMatches.length - 1]?.[1]?.trim() ?? "";
  const arena =
    arenaLine &&
    !arenaLine.includes("\n") &&
    !arenaLine.includes("\r") &&
    existsSync(arenaLine)
      ? arenaLine
      : null;
  return { arena, path: pathLine };
}

function probeFromLoginShell(): LoginProbe {
  if (process.platform === "win32") {
    return probeWindowsArena();
  }
  const env = shellProbeEnv();
  const script =
    'arena_p=$(command -v arena 2>/dev/null); printf "WATCHTOWER_PATH=%s\\nWATCHTOWER_ARENA=%s\\n" "$PATH" "${arena_p:-}"';
  const shells: string[] =
    process.platform === "darwin"
      ? ["/bin/zsh", "/bin/bash"]
      : ["/usr/bin/zsh", "/bin/zsh", "/usr/bin/bash", "/bin/bash"];
  for (const sh of shells) {
    if (!existsSync(sh)) continue;
    try {
      const raw = execFileSync(sh, ["-ilc", script], {
        encoding: "utf8",
        timeout: 15_000,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed = parseWatchtowerProbeLines(raw);
      if (parsed.arena || parsed.path.length > 0) return parsed;
    } catch {
      /* try next shell */
    }
  }
  return { arena: null, path: "" };
}

function probeWindowsArena(): LoginProbe {
  const pathMerged = mergePathSegments(windowsExtraDirs(), process.env.PATH ?? "");
  const env = { ...process.env, PATH: pathMerged };
  try {
    const raw = execFileSync("where.exe", ["arena"], {
      encoding: "utf8",
      timeout: 8000,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = raw.split(/\r?\n/).find((s) => {
      const t = s.trim();
      return t.length > 0 && existsSync(t);
    });
    return { arena: line?.trim() ?? null, path: pathMerged };
  } catch {
    return { arena: null, path: pathMerged };
  }
}

function windowsExtraDirs(): string[] {
  const extra: string[] = [];
  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    extra.push(join(userProfile, "AppData", "Roaming", "npm"));
  }
  if (process.env.APPDATA) {
    extra.push(join(process.env.APPDATA, "npm"));
  }
  if (process.env.LOCALAPPDATA) {
    extra.push(join(process.env.LOCALAPPDATA, "pnpm"));
  }
  return extra;
}

function unixExtraDirs(): string[] {
  const extra: string[] = [];
  if (process.platform === "darwin") {
    extra.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
  } else if (process.platform === "linux" || process.platform === "freebsd") {
    extra.push("/usr/local/bin", "/usr/bin", "/bin");
  }
  const home = homedir();
  if (home) {
    extra.push(
      join(home, ".local", "bin"),
      join(home, ".npm-global", "bin"),
      join(home, ".volta", "bin"),
      join(home, ".fnm", "aliases", "default", "bin"),
    );
  }
  return extra;
}

function mergePathSegments(first: string[], second: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (dir: string) => {
    const d = dir.trim();
    if (!d || seen.has(d)) return;
    seen.add(d);
    out.push(d);
  };
  for (const d of first) push(d);
  for (const d of second.split(delimiter)) push(d);
  return out.join(delimiter);
}

function getLoginProbe(): LoginProbe {
  if (probeMemo === undefined) {
    probeMemo = probeFromLoginShell();
  }
  return probeMemo;
}

/**
 * Absolute path to `arena` when resolved via the user shell; otherwise the
 * bare name (relies on `cliSpawnEnv().PATH`).
 */
export function getArenaExecutable(): string {
  return getLoginProbe().arena ?? "arena";
}

/**
 * Environment for spawning `arena`. Merges PATH from a login/interactive
 * shell (DMG / Finder launches) with common install dirs and `process.env`.
 */
export function cliSpawnEnv(): NodeJS.ProcessEnv {
  const { path: loginPath } = getLoginProbe();
  const extras =
    process.platform === "win32" ? windowsExtraDirs() : unixExtraDirs();
  const merged = mergePathSegments(
    [...extras, ...loginPath.split(delimiter)],
    process.env.PATH ?? "",
  );
  return { ...process.env, PATH: merged };
}
