import type { ArenaWatcherApi } from "../shared/types.js";

declare global {
  interface Window {
    arenaWatcher: ArenaWatcherApi;
  }
}

export {};
