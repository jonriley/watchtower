import { spawn } from "node:child_process";
import { cliSpawnEnv, getArenaExecutable } from "./cliPathEnv.js";

/**
 * Split the line after `arena` into argv pieces; supports double quotes.
 */
function parseArenaArgv(rest: string): string[] {
  const args: string[] = [];
  let i = 0;
  const s = rest.trim();
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      i++;
      let chunk = "";
      while (i < s.length && s[i] !== '"') chunk += s[i++]!;
      if (s[i] === '"') i++;
      args.push(chunk);
    } else {
      let chunk = "";
      while (i < s.length && !/\s/.test(s[i]!)) chunk += s[i++]!;
      args.push(chunk);
    }
  }
  return args;
}

export type RunArenaCliResult =
  | {
      ok: true;
      code: number | null;
      stdout: string;
      stderr: string;
    }
  | { ok: false; error: string };

export async function runArenaCliLine(line: string): Promise<RunArenaCliResult> {
  const trimmed = line.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a command." };
  }
  if (!/^arena(\s|$)/i.test(trimmed)) {
    return {
      ok: false,
      error: "Only commands starting with arena are allowed (e.g. arena whoami).",
    };
  }
  const after = trimmed.replace(/^arena\s*/i, "").trim();
  if (!after) {
    return {
      ok: false,
      error:
        "Running bare arena can hang in a GUI. Try arena whoami, arena ping, or arena --help.",
    };
  }
  const argv = parseArenaArgv(after);
  if (argv.length === 0) {
    return { ok: false, error: "Missing arguments after arena." };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: RunArenaCliResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const child = spawn(getArenaExecutable(), argv, {
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
        finish({
          ok: false,
          error:
            "arena CLI not found on PATH. Install with: npm install -g @aredotna/cli",
        });
        return;
      }
      finish({ ok: false, error: String(err.message) });
    });
    child.on("close", (code) => {
      finish({ ok: true, code, stdout, stderr });
    });
  });
}
