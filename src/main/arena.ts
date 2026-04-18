import { spawn } from "node:child_process";
import { once } from "node:events";
import type { ChannelListItem } from "../shared/types.js";
import { cliSpawnEnv, getArenaExecutable } from "./cliPathEnv.js";

export type ArenaJsonError = {
  error: string;
  code: number | null;
  type: string;
  hint?: string;
};

export type ArenaResult<T = unknown> =
  | { ok: true; data: T; raw: string }
  | {
      ok: false;
      arenaError?: ArenaJsonError;
      message: string;
      exitCode: number | null;
      stderr: string;
      stdout?: string;
    };

function tryParseArenaJsonError(blob: string): ArenaJsonError | undefined {
  try {
    const errObj = parseArenaStdoutJson(blob) as Record<string, unknown>;
    if (errObj && typeof errObj === "object" && "error" in errObj) {
      return errObj as unknown as ArenaJsonError;
    }
  } catch {
    /* not JSON */
  }
  return undefined;
}

/** User-facing text for failed arena --json commands (Activity log, dialogs). */
export function describeArenaFailure(r: Extract<ArenaResult<unknown>, { ok: false }>): string {
  const err = r.arenaError;
  const primary = err?.error || r.message;
  const bits: string[] = [primary];
  if (err?.hint && !primary.includes(err.hint)) bits.push(err.hint);
  const forbidden =
    r.exitCode === 6 ||
    /forbidden|^403\b/i.test(primary) ||
    (err?.type && /forbidden/i.test(err.type));
  if (forbidden) {
    bits.push(
      "No write access to this channel—choose one you own or collaborate on, or create a channel below.",
    );
  }
  return bits.join(" — ");
}

/**
 * arena --json often prints a single pretty-printed object across multiple lines.
 * Never use "last line only" — that can be just `}` and fail to parse.
 */
function parseArenaStdoutJson(stdout: string): unknown {
  const t = stdout.trim();
  if (!t) throw new SyntaxError("empty stdout");
  try {
    return JSON.parse(t);
  } catch {
    const o0 = t.indexOf("{");
    const o1 = t.lastIndexOf("}");
    if (o0 !== -1 && o1 > o0) {
      return JSON.parse(t.slice(o0, o1 + 1)) as unknown;
    }
    const a0 = t.indexOf("[");
    const a1 = t.lastIndexOf("]");
    if (a0 !== -1 && a1 > a0) {
      return JSON.parse(t.slice(a0, a1 + 1)) as unknown;
    }
    for (const line of t.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        return JSON.parse(s) as unknown;
      } catch {
        /* try next line */
      }
    }
    throw new SyntaxError("no JSON object found in stdout");
  }
}

export async function runArenaJson(
  args: string[],
): Promise<ArenaResult<unknown>> {
  return new Promise((resolve) => {
    const child = spawn(getArenaExecutable(), args, {
      env: cliSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        resolve({
          ok: false,
          message:
            "arena CLI not found. Install with: npm install -g @aredotna/cli",
          exitCode: null,
          stderr: stderr || String(err.message),
        });
        return;
      }
      resolve({
        ok: false,
        message: String(err.message),
        exitCode: null,
        stderr: stderr || String(err),
      });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        let arenaError =
          tryParseArenaJsonError(stderr) ?? tryParseArenaJsonError(stdout);
        resolve({
          ok: false,
          arenaError,
          message:
            arenaError?.error ||
            stderr.trim() ||
            stdout.trim() ||
            `arena exited with code ${code ?? "unknown"}`,
          exitCode: code,
          stderr,
          stdout,
        });
        return;
      }
      try {
        const data = parseArenaStdoutJson(stdout);
        resolve({ ok: true, data, raw: stdout });
      } catch (e) {
        resolve({
          ok: false,
          message: `Invalid JSON from arena: ${String((e as Error).message)}`,
          exitCode: code,
          stderr,
        });
      }
    });
  });
}

export async function arenaUpload(
  filePath: string,
  channel: string,
): Promise<ArenaResult<unknown>> {
  return runArenaJson([
    "upload",
    filePath,
    "--channel",
    channel,
    "--json",
  ]);
}

export async function arenaWhoami(): Promise<ArenaResult<unknown>> {
  return runArenaJson(["whoami", "--json"]);
}

/** Slug of the authenticated user from `arena whoami --json`. */
export function extractUserSlugFromWhoami(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.slug === "string" && o.slug.trim()) return o.slug.trim();
  const u = o.user;
  if (u && typeof u === "object") {
    const s = (u as Record<string, unknown>).slug;
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return null;
}

/**
 * Walk JSON from `arena user contents … --type Channel --json` and collect
 * channel-like objects (slug + title).
 */
export function parseChannelListItems(data: unknown): ChannelListItem[] {
  const seen = new Set<string>();
  const out: ChannelListItem[] = [];

  const maybeAdd = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.slug !== "string" || !o.slug.trim()) return;
    const looksLikeChannel =
      o.base_class === "Channel" ||
      (typeof o.visibility === "string" && o.visibility.length > 0);
    if (!looksLikeChannel) return;
    const slug = o.slug.trim();
    if (seen.has(slug)) return;
    const title =
      typeof o.title === "string" && o.title.trim() ? o.title.trim() : slug;
    seen.add(slug);
    out.push({ slug, title });
  };

  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    maybeAdd(node);
    for (const v of Object.values(o)) {
      if (Array.isArray(v) || (v && typeof v === "object")) visit(v);
    }
  };

  visit(data);
  return out.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

export async function arenaUserContentsChannels(
  userSlug: string,
  page: number,
  perPage: number,
): Promise<ArenaResult<unknown>> {
  return runArenaJson([
    "user",
    "contents",
    userSlug,
    "--type",
    "Channel",
    "--per",
    String(perPage),
    "--page",
    String(page),
    "--json",
  ]);
}

export async function arenaChannelCreate(
  title: string,
  visibility: "public" | "private" | "closed",
): Promise<ArenaResult<unknown>> {
  return runArenaJson([
    "channel",
    "create",
    title,
    "--visibility",
    visibility,
    "--json",
  ]);
}

/** Wait for arena process to exit (used when stdout is not JSON). */
export async function runArena(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(getArenaExecutable(), args, {
    env: cliSpawnEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (c: Buffer) => {
    stdout += c.toString();
  });
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString();
  });
  const [code] = (await once(child, "close")) as [number | null];
  return { code, stdout, stderr };
}
