import Store from "electron-store";
import { app } from "electron";
import type { AppConfig, ThemePreference, UiLocale } from "../shared/types.js";

export type { AppConfig, ThemePreference, UiLocale } from "../shared/types.js";

const defaults: AppConfig = {
  watchPath: "",
  channelSlugOrId: "clutter",
  recursive: false,
  theme: "system",
  openAtLogin: true,
  offerTrashAfterUpload: true,
  uiLocale: "en",
};

const UI_LOCALES: readonly UiLocale[] = [
  "en",
  "es",
  "zh",
  "ar",
  "fr",
  "ja",
  "sv",
  "is",
  "de",
  "ru",
  "it",
];

const store = new Store<{ config: AppConfig }>({
  name: "arena-folder-watcher",
  defaults: { config: { ...defaults } },
});

export function getConfig(): AppConfig {
  const c = store.get("config");
  const merged = { ...defaults, ...c, theme: c.theme ?? defaults.theme };
  const ch = merged.channelSlugOrId?.trim();
  merged.channelSlugOrId = ch || defaults.channelSlugOrId;
  merged.openAtLogin =
    typeof c.openAtLogin === "boolean" ? c.openAtLogin : defaults.openAtLogin;
  merged.offerTrashAfterUpload =
    typeof c.offerTrashAfterUpload === "boolean"
      ? c.offerTrashAfterUpload
      : defaults.offerTrashAfterUpload;
  const loc = c.uiLocale;
  merged.uiLocale =
    typeof loc === "string" && (UI_LOCALES as readonly string[]).includes(loc)
      ? (loc as UiLocale)
      : defaults.uiLocale;
  return merged;
}

export function setConfig(partial: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(), ...partial };
  store.set("config", next);
  return next;
}

export type WatchFolderAccess = {
  path: string | null;
  /** Call when stopping the watcher (macOS App Store / security-scoped bookmarks). */
  releaseSecurityScopedAccess?: () => void;
};

/**
 * Begin filesystem access for the configured watch folder.
 * On macOS with a stored security-scoped bookmark, starts scoped access.
 */
export function beginWatchFolderAccess(): WatchFolderAccess {
  const { watchPath, watchFolderBookmark } = getConfig();
  if (!watchPath?.trim()) return { path: null };
  if (process.platform !== "darwin" || !watchFolderBookmark) {
    return { path: watchPath };
  }
  const release = app.startAccessingSecurityScopedResource(
    watchFolderBookmark,
  ) as () => void;
  return {
    path: watchPath,
    releaseSecurityScopedAccess: typeof release === "function" ? release : undefined,
  };
}

export function endWatchFolderAccess(release?: () => void): void {
  if (typeof release === "function") release();
}
