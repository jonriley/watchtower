import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { arenaUpload, describeArenaFailure } from "./arena.js";
import type { AppConfig } from "./config.js";

export type LogEntry = {
  at: string;
  level: "info" | "error" | "success";
  message: string;
  file?: string;
};

const MAX_LOGS = 200;

export type FolderWatcherHooks = {
  onUploadSucceeded?: (absPath: string) => void | Promise<void>;
};

export class FolderWatcher {
  private watcher: FSWatcher | null = null;
  private logs: LogEntry[] = [];
  private uploadQueue: Promise<void> = Promise.resolve();
  private resolveWatchPath: (() => string | null) | null = null;
  /** Latest upload target from settings (read on each upload, not only at Start). */
  private resolveChannelSlug: (() => string | null) | null = null;

  constructor(
    private readonly broadcast: (entry: LogEntry) => void,
    private readonly hooks: FolderWatcherHooks = {},
  ) {}

  getRecentLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs.length = 0;
  }

  private pushLog(entry: LogEntry) {
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
    this.broadcast(entry);
  }

  setAccessResolver(resolver: () => string | null) {
    this.resolveWatchPath = resolver;
  }

  setChannelResolver(resolver: () => string | null) {
    this.resolveChannelSlug = resolver;
  }

  isRunning(): boolean {
    return this.watcher != null;
  }

  async start(config: AppConfig): Promise<{ ok: true } | { ok: false; message: string }> {
    await this.stop();
    if (!config.watchPath?.trim()) {
      return { ok: false, message: "Set a watch folder first." };
    }
    if (!config.channelSlugOrId?.trim()) {
      return { ok: false, message: "Set an Are.na channel slug or id first." };
    }
    const root =
      this.resolveWatchPath?.() ?? config.watchPath;
    if (!root) {
      return { ok: false, message: "Could not access the watch folder (bookmark?)." };
    }

    const channelLabel = config.channelSlugOrId.trim();

    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      depth: config.recursive ? undefined : 0,
      awaitWriteFinish: {
        stabilityThreshold: 600,
        pollInterval: 120,
      },
    });

    this.watcher.on("add", (path: string) => {
      void this.enqueueUpload(path);
    });

    this.watcher.on("error", (err: unknown) => {
      this.pushLog({
        at: new Date().toISOString(),
        level: "error",
        message: `Watcher error: ${String(err)}`,
      });
    });

    this.pushLog({
      at: new Date().toISOString(),
      level: "info",
      message: `Watching "${root}" → uploads use channel from settings (currently ${channelLabel})`,
    });
    return { ok: true };
  }

  private enqueueUpload(absPath: string) {
    this.uploadQueue = this.uploadQueue.then(() => this.tryUpload(absPath));
  }

  private async tryUpload(absPath: string) {
    const channel =
      this.resolveChannelSlug?.()?.trim() ?? "";
    if (!channel) {
      this.pushLog({
        at: new Date().toISOString(),
        level: "error",
        message: "No channel slug in settings — choose a channel and save.",
        file: absPath,
      });
      return;
    }
    try {
      const st = await stat(absPath);
      if (!st.isFile()) return;
    } catch (e) {
      this.pushLog({
        at: new Date().toISOString(),
        level: "error",
        message: `Stat failed: ${String((e as Error).message)}`,
        file: absPath,
      });
      return;
    }

    const name = basename(absPath);
    if (name.startsWith(".")) return;

    this.pushLog({
      at: new Date().toISOString(),
      level: "info",
      message: `Uploading ${name}…`,
      file: absPath,
    });

    const result = await arenaUpload(absPath, channel);
    if (result.ok) {
      this.pushLog({
        at: new Date().toISOString(),
        level: "success",
        message: `Uploaded ${name}`,
        file: absPath,
      });
      const hook = this.hooks.onUploadSucceeded;
      if (hook) {
        void Promise.resolve(hook(absPath)).catch((err: unknown) => {
          this.pushLog({
            at: new Date().toISOString(),
            level: "error",
            message: `After-upload hook: ${String((err as Error)?.message ?? err)}`,
            file: absPath,
          });
        });
      }
    } else {
      this.pushLog({
        at: new Date().toISOString(),
        level: "error",
        message: describeArenaFailure(result),
        file: absPath,
      });
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    await this.uploadQueue;
  }
}
