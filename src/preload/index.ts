import { contextBridge, ipcRenderer } from "electron";
import type {
  ArenaWatcherApi,
  LogEntry,
  PrefsI18nBundle,
  ThemePreference,
  UiLocale,
} from "../shared/types.js";

export type {
  AppConfig,
  ArenaWatcherApi,
  LogEntry,
  PrefsI18nBundle,
  ThemePreference,
  UiLocale,
} from "../shared/types.js";

const api: ArenaWatcherApi = {
  getConfig: () => ipcRenderer.invoke("getConfig"),
  getPrefsBundle: () => ipcRenderer.invoke("getPrefsBundle"),
  setConfig: (partial) => ipcRenderer.invoke("setConfig", partial),
  getLogs: () => ipcRenderer.invoke("getLogs"),
  clearLogs: () => ipcRenderer.invoke("clearLogs"),
  getPlatform: () => ipcRenderer.invoke("getPlatform"),
  openSystemLoginItemsSettings: () =>
    ipcRenderer.invoke("openSystemLoginItemsSettings"),
  whoami: () => ipcRenderer.invoke("whoami"),
  listMyChannels: () => ipcRenderer.invoke("listMyChannels"),
  createChannel: (payload) => ipcRenderer.invoke("createChannel", payload),
  pickWatchFolder: () => ipcRenderer.invoke("pickWatchFolder"),
  startWatcher: () => ipcRenderer.invoke("startWatcher"),
  stopWatcher: () => ipcRenderer.invoke("stopWatcher"),
  watcherStatus: () => ipcRenderer.invoke("watcherStatus"),
  runArenaCli: (line) => ipcRenderer.invoke("runArenaCli", line),
  onLog: (handler) => {
    const fn = (_e: unknown, entry: LogEntry) => handler(entry);
    ipcRenderer.on("log", fn);
    return () => {
      ipcRenderer.removeListener("log", fn);
    };
  },
  onLogsCleared: (handler) => {
    const fn = () => handler();
    ipcRenderer.on("logs-cleared", fn);
    return () => {
      ipcRenderer.removeListener("logs-cleared", fn);
    };
  },
  onThemeFromMain: (handler) => {
    const fn = (_e: unknown, theme: ThemePreference) => handler(theme);
    ipcRenderer.on("theme-from-main", fn);
    return () => {
      ipcRenderer.removeListener("theme-from-main", fn);
    };
  },
  onLocaleFromMain: (handler) => {
    const fn = (_e: unknown, locale: UiLocale) => handler(locale);
    ipcRenderer.on("locale-from-main", fn);
    return () => {
      ipcRenderer.removeListener("locale-from-main", fn);
    };
  },
};

contextBridge.exposeInMainWorld("arenaWatcher", api);
