export type ThemePreference = "light" | "dark" | "system";

/** Preferences string tables loaded from disk in main (renderer must not import JSON under `file://`). */
export type PrefsI18nBundle = Record<string, Record<string, string>>;

/** Preferences UI language (matches `locales/prefs.json` keys). */
export type UiLocale =
  | "en"
  | "es"
  | "zh"
  | "ar"
  | "fr"
  | "ja"
  | "sv"
  | "is"
  | "de"
  | "ru"
  | "it";

/** Channel row for the upload-target dropdown (from `arena user contents … --type Channel`). */
export type ChannelListItem = { slug: string; title: string };

export type AppConfig = {
  watchPath: string;
  channelSlugOrId: string;
  recursive: boolean;
  watchFolderBookmark?: string;
  theme: ThemePreference;
  /** macOS / Windows: open app when the user logs in. */
  openAtLogin: boolean;
  /** After a successful upload, ask whether to move the source file to Trash. */
  offerTrashAfterUpload: boolean;
  /** Preferences window language. */
  uiLocale: UiLocale;
};

export type LogEntry = {
  at: string;
  level: "info" | "error" | "success";
  message: string;
  file?: string;
};

export type ArenaWatcherApi = {
  getConfig: () => Promise<AppConfig>;
  /** Full Preferences locale tables (read once from `locales/prefs.json` in main). */
  getPrefsBundle: () => Promise<PrefsI18nBundle>;
  setConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>;
  getLogs: () => Promise<LogEntry[]>;
  clearLogs: () => Promise<void>;
  getPlatform: () => Promise<"darwin" | "win32" | "linux">;
  openSystemLoginItemsSettings: () => Promise<
    { ok: true } | { ok: false; message: string }
  >;
  whoami: () => Promise<
    | { ok: true; data: unknown }
    | { ok: false; message: string; exitCode: number | null }
  >;
  listMyChannels: () => Promise<
    | { ok: true; channels: ChannelListItem[] }
    | { ok: false; message: string; exitCode: number | null }
  >;
  createChannel: (payload: {
    title: string;
    visibility: "public" | "private" | "closed";
  }) => Promise<
    | { ok: true; slug: string | null; data: unknown }
    | { ok: false; message: string; exitCode: number | null }
  >;
  pickWatchFolder: () => Promise<
    | { canceled: true }
    | { canceled: false; path: string; bookmark?: string }
  >;
  startWatcher: () => Promise<{ ok: true } | { ok: false; message: string }>;
  stopWatcher: () => Promise<{ ok: true }>;
  watcherStatus: () => Promise<{ running: boolean }>;
  onLog: (handler: (entry: LogEntry) => void) => () => void;
  onLogsCleared: (handler: () => void) => () => void;
  /** Main process pushes theme when it changes in any window (sync UI + window chrome). */
  onThemeFromMain: (handler: (theme: ThemePreference) => void) => () => void;
  onLocaleFromMain: (handler: (locale: UiLocale) => void) => () => void;
  runArenaCli: (line: string) => Promise<
    | { ok: true; code: number | null; stdout: string; stderr: string }
    | { ok: false; error: string }
  >;
};
