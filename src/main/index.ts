import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage,
  type OpenDialogOptions,
} from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  arenaChannelCreate,
  arenaUserContentsChannels,
  arenaWhoami,
  extractUserSlugFromWhoami,
  parseChannelListItems,
} from "./arena.js";
import { runArenaCliLine } from "./cliTerminal.js";
import type { AppConfig, ThemePreference, UiLocale } from "./config.js";
import {
  beginWatchFolderAccess,
  endWatchFolderAccess,
  getConfig,
  setConfig,
} from "./config.js";
import type { ChannelListItem, PrefsI18nBundle } from "../shared/types.js";
import type { LogEntry } from "./watcher.js";
import { FolderWatcher } from "./watcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Menu bar / About / dev `electron .` identity (must run before ready). */
app.setName("Watchtower");
app.name = "Watchtower";

let prefsI18nBundle: PrefsI18nBundle | null = null;

function loadPrefsI18nBundle(): PrefsI18nBundle {
  if (!prefsI18nBundle) {
    const p = join(__dirname, "../renderer/locales/prefs.json");
    prefsI18nBundle = JSON.parse(readFileSync(p, "utf8")) as PrefsI18nBundle;
  }
  return prefsI18nBundle;
}

/**
 * Resolve bundled assets under dist/assets, then next to package.json, then cwd.
 * Dev `electron .` often has icons only in ./assets until copy-static runs.
 */
function firstExistingAsset(file: "icon.png" | "trayTemplate.png"): string | undefined {
  const candidates = [
    resolvePath(join(__dirname, "../assets", file)),
    resolvePath(join(app.getAppPath(), "assets", file)),
    resolvePath(join(process.cwd(), "assets", file)),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function resolvedAppIconPath(): string | undefined {
  return firstExistingAsset("icon.png");
}

/** Raster icon for APIs that need a NativeImage (e.g. some Tray paths). */
function appIconImage(): NativeImage | undefined {
  const p = resolvedAppIconPath();
  if (!p) return undefined;
  try {
    const img = nativeImage.createFromPath(p);
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

function applyDockIconIfDarwin(): void {
  if (process.platform !== "darwin") return;
  const p = resolvedAppIconPath();
  if (!p) {
    if (process.defaultApp) {
      console.warn(
        "[Watchtower] No icon PNG found (looked in dist/assets, app path assets, cwd/assets). From the project folder run: npm run build",
      );
    }
    return;
  }
  try {
    app.dock.setIcon(p);
  } catch (e) {
    console.warn("[Watchtower] app.dock.setIcon failed:", e);
  }
}

/** macOS sometimes keeps the Electron dock tile until a later tick; retry a few times. */
function scheduleDockIconRetries(): void {
  applyDockIconIfDarwin();
  setTimeout(applyDockIconIfDarwin, 400);
  setTimeout(applyDockIconIfDarwin, 1500);
}

let mainWindow: BrowserWindow | null = null;
let prefsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let activeSecurityScopedRelease: (() => void) | undefined;
/** After the user dismisses the login prompt, do not show it again until restart. */
let arenaLoginPromptDismissed = false;

async function promptMoveUploadedFileToTrash(absPath: string): Promise<void> {
  if (!getConfig().offerTrashAfterUpload) return;
  const parent =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getFocusedWindow();
  const trashQuestion = {
    type: "question" as const,
    title: "Watchtower",
    message: `Move “${basename(absPath)}” to Trash?`,
    detail:
      "The file was uploaded to Are.na. You can remove the local copy or keep it.",
    buttons: ["Move to Trash", "Keep file"],
    defaultId: 1,
    cancelId: 1,
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, trashQuestion)
    : await dialog.showMessageBox(trashQuestion);
  if (response !== 0) return;
  try {
    await shell.trashItem(absPath);
  } catch (e) {
    const p =
      parent ??
      (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null) ??
      BrowserWindow.getFocusedWindow();
    const errBox = {
      type: "warning" as const,
      title: "Watchtower",
      message: "Could not move the file to Trash.",
      detail: String((e as Error).message),
    };
    if (p) await dialog.showMessageBox(p, errBox);
    else await dialog.showMessageBox(errBox);
  }
}

const folderWatcher = new FolderWatcher(
  (entry: LogEntry) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send("log", entry);
    }
  },
  {
    onUploadSucceeded: (absPath) => promptMoveUploadedFileToTrash(absPath),
  },
);

function preloadPath(): string {
  return join(__dirname, "../preload/index.js");
}

function rendererIndexPath(): string {
  return join(__dirname, "../renderer/index.html");
}

function rendererPreferencesPath(): string {
  return join(__dirname, "../renderer/preferences.html");
}

/** Main dashboard (channel, CLI, activity). */
const WINDOW_CONTENT_WIDTH = 1166;
const WINDOW_CONTENT_HEIGHT = 666;

/** Preferences sheet (appearance, general, watch folder). */
const PREFS_WIDTH = 520;
const PREFS_HEIGHT = 620;

function showMainDashboard(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  createMainWindow();
}

function showPreferencesWindow(): void {
  if (prefsWindow && !prefsWindow.isDestroyed()) {
    prefsWindow.show();
    prefsWindow.focus();
    return;
  }
  createPrefsWindow();
}

function syncLoginItemFromConfig(): void {
  const open = getConfig().openAtLogin;
  try {
    if (process.defaultApp && process.argv[1]) {
      app.setLoginItemSettings({
        openAtLogin: open,
        path: process.execPath,
        args: [resolvePath(process.argv[1])],
      });
    } else {
      app.setLoginItemSettings({ openAtLogin: open });
    }
  } catch {
    /* ignore unsupported environments */
  }
}

function buildApplicationMenu(): void {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Watchtower",
          submenu: [
            { role: "about" },
            { type: "separator" },
            {
              /* ASCII "..." avoids macOS replacing some "Preferences…" items with "Settings" */
              label: "Preferences...",
              accelerator: "Command+,",
              click: () => showPreferencesWindow(),
            },
            {
              label: "Open Login Items in System Settings…",
              click: () => {
                void openSystemStartupSettings().then((r) => {
                  if (!r.ok) notifyStartupSettingsOpenFailed(r.message);
                });
              },
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
        {
          label: "Help",
          submenu: [
            {
              label: "Are.na CLI",
              click: () =>
                void shell.openExternal("https://github.com/aredotna/cli"),
            },
          ],
        },
      ]),
    );
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            label: "Preferences...",
            accelerator: "Ctrl+,",
            click: () => showPreferencesWindow(),
          },
          {
            label: "Open startup apps in Settings…",
            click: () => {
              void openSystemStartupSettings().then((r) => {
                if (!r.ok) notifyStartupSettingsOpenFailed(r.message);
              });
            },
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
    ]),
  );
}

function createMainWindow(): void {
  const iconPath = resolvedAppIconPath();
  mainWindow = new BrowserWindow({
    title: "Watchtower",
    width: WINDOW_CONTENT_WIDTH,
    height: WINDOW_CONTENT_HEIGHT,
    useContentSize: true,
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void mainWindow
    .loadFile(rendererIndexPath())
    .then(() => {
      const w = mainWindow;
      if (!w || w.isDestroyed()) return;
      void runStartupAfterUiLoad(w);
    })
    .catch(() => {
      /* load errors surfaced by Electron */
    });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
}

function createPrefsWindow(): void {
  const iconPath = resolvedAppIconPath();
  prefsWindow = new BrowserWindow({
    title: "Watchtower Preferences",
    width: PREFS_WIDTH,
    height: PREFS_HEIGHT,
    useContentSize: true,
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void prefsWindow.loadFile(rendererPreferencesPath());
  prefsWindow.on("closed", () => {
    prefsWindow = null;
  });
  prefsWindow.once("ready-to-show", () => {
    prefsWindow?.show();
  });
}

function openArenaLoginExternally(host: BrowserWindow | null): void {
  if (process.platform === "darwin") {
    execFile(
      "osascript",
      ["-e", 'tell application "Terminal" to do script "arena login"'],
      (err) => {
        if (err && host && !host.isDestroyed()) {
          void dialog.showMessageBox(host, {
            type: "warning",
            message: "Could not open Terminal.",
            detail: `${String(err.message)}\n\nRun manually: arena login`,
          });
        }
      },
    );
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "cmd", "/k", "arena login"], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    }).unref();
    return;
  }
  if (host && !host.isDestroyed()) {
    void dialog.showMessageBox(host, {
      type: "info",
      message: "Open a terminal on this machine and run:",
      detail: "arena login",
    });
  }
}

/**
 * If the CLI has no valid session, offer to open a terminal with `arena login`.
 * Tokens are stored by the CLI on disk after a successful login.
 */
async function ensureArenaLoggedIn(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  if (arenaLoginPromptDismissed) return;
  const r = await arenaWhoami();
  if (r.ok) return;
  if (/CLI not found|not found on PATH|ENOENT/i.test(r.message)) return;
  const unauthorized =
    r.exitCode === 2 || /401|unauthorized|not logged|log in/i.test(r.message);
  if (!unauthorized) return;

  const buttons =
    process.platform === "darwin" || process.platform === "win32"
      ? ["Open login in terminal", "Not now"]
      : ["OK"];
  const { response } = await dialog.showMessageBox(win, {
    type: "info",
    title: "Log in to Are.na",
    message: "The Are.na CLI is not logged in (or your session expired).",
    detail:
      "After you log in once with arena login, your token stays on this computer and you usually will not need to sign in again.",
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  if (buttons.length > 1 && response === buttons.length - 1) {
    arenaLoginPromptDismissed = true;
  }
  if (response === 0 && buttons[0] === "Open login in terminal") {
    openArenaLoginExternally(win);
  }
}

async function listMyChannelsFromCli(): Promise<
  | { ok: true; channels: ChannelListItem[] }
  | { ok: false; message: string; exitCode: number | null }
> {
  const w = await arenaWhoami();
  if (!w.ok) {
    return { ok: false, message: w.message, exitCode: w.exitCode };
  }
  const userSlug = extractUserSlugFromWhoami(w.data);
  if (!userSlug) {
    return {
      ok: false,
      message: "Could not read your username from arena whoami.",
      exitCode: null,
    };
  }
  const per = 100;
  const merged = new Map<string, ChannelListItem>();
  for (let page = 1; page <= 50; page++) {
    const r = await arenaUserContentsChannels(userSlug, page, per);
    if (!r.ok) {
      return { ok: false, message: r.message, exitCode: r.exitCode };
    }
    const batch = parseChannelListItems(r.data);
    if (batch.length === 0) break;
    for (const c of batch) merged.set(c.slug, c);
    if (batch.length < per) break;
  }
  const channels = [...merged.values()].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
  return { ok: true, channels };
}

async function runStartupAfterUiLoad(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  await ensureArenaLoggedIn(win);
  if (win.isDestroyed()) return;
  const c = getConfig();
  if (c.watchPath?.trim() && c.channelSlugOrId?.trim()) {
    const r = await startWatcherFromConfig();
    if (!r.ok && !win.isDestroyed()) {
      void dialog.showMessageBox(win, {
        type: "warning",
        title: "Watcher did not start",
        message: r.message,
      });
    }
  }
}

function trayIcon(): NativeImage {
  const p = firstExistingAsset("trayTemplate.png");
  const fromFile = p ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
  if (p && !fromFile.isEmpty()) {
    if (process.platform === "darwin") fromFile.setTemplateImage(true);
    return fromFile;
  }
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return nativeImage.createFromDataURL(`data:image/png;base64,${png}`);
}

function buildTrayMenu(): Menu {
  const top: MenuItemConstructorOptions[] = [
    {
      label: "Open Watchtower",
      click: () => showMainDashboard(),
    },
    {
      label: "Preferences...",
      accelerator: process.platform === "darwin" ? "Command+," : "Ctrl+,",
      click: () => showPreferencesWindow(),
    },
    { type: "separator" },
  ];
  return Menu.buildFromTemplate([
    ...top,
    {
      label: "Start watcher",
      click: () => {
        void startWatcherFromConfig().then((r) => {
          if (!r.ok && r.message) {
            void dialog.showMessageBox({
              type: "warning",
              message: r.message,
            });
          }
        });
      },
    },
    {
      label: "Stop watcher",
      click: () => {
        void stopWatcher();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip("Watchtower");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    showMainDashboard();
  });
}

async function startWatcherFromConfig(): Promise<{ ok: true } | { ok: false; message: string }> {
  const cfg = getConfig();
  const acc = beginWatchFolderAccess();
  activeSecurityScopedRelease = acc.releaseSecurityScopedAccess;
  const root = acc.path ?? cfg.watchPath;
  if (!root?.trim()) {
    endWatchFolderAccess(activeSecurityScopedRelease);
    activeSecurityScopedRelease = undefined;
    return { ok: false, message: "Set a watch folder first." };
  }
  folderWatcher.setAccessResolver(() => root);
  folderWatcher.setChannelResolver(() => getConfig().channelSlugOrId.trim() || null);
  const started = await folderWatcher.start({ ...cfg, watchPath: root });
  if (!started.ok) {
    endWatchFolderAccess(activeSecurityScopedRelease);
    activeSecurityScopedRelease = undefined;
    return started;
  }
  return { ok: true };
}

async function stopWatcher(): Promise<void> {
  await folderWatcher.stop();
  endWatchFolderAccess(activeSecurityScopedRelease);
  activeSecurityScopedRelease = undefined;
}

function extractChannelSlug(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.slug === "string") return o.slug;
  const ch = o.channel;
  if (ch && typeof ch === "object") {
    const s = (ch as Record<string, unknown>).slug;
    if (typeof s === "string") return s;
  }
  return null;
}

function syncNativeChromeTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme === "system" ? "system" : theme;
}

async function openSystemStartupSettings(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    if (process.platform === "darwin") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
      );
      return { ok: true as const };
    }
    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:startupapps");
      return { ok: true as const };
    }
    return {
      ok: false as const,
      message: "Use your desktop environment’s startup / session settings.",
    };
  } catch (e) {
    return {
      ok: false as const,
      message: String((e as Error).message),
    };
  }
}

function notifyStartupSettingsOpenFailed(message: string): void {
  const p = BrowserWindow.getFocusedWindow();
  const box = {
    type: "warning" as const,
    title: "Watchtower",
    message: "Could not open startup settings.",
    detail: message,
  };
  if (p && !p.isDestroyed()) void dialog.showMessageBox(p, box);
  else void dialog.showMessageBox(box);
}

function registerIpc(): void {
  ipcMain.handle("getConfig", () => getConfig());
  ipcMain.handle("getPrefsBundle", () => loadPrefsI18nBundle());
  ipcMain.handle("setConfig", (_e, partial: Partial<AppConfig>) => {
    const next = setConfig(partial);
    if (partial.theme !== undefined) {
      syncNativeChromeTheme(next.theme);
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send("theme-from-main", next.theme);
      }
    }
    if (partial.uiLocale !== undefined) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send("locale-from-main", next.uiLocale as UiLocale);
      }
    }
    if (partial.openAtLogin !== undefined) syncLoginItemFromConfig();
    return next;
  });
  ipcMain.handle("getLogs", () => folderWatcher.getRecentLogs());
  ipcMain.handle("clearLogs", () => {
    folderWatcher.clearLogs();
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send("logs-cleared");
    }
    return undefined;
  });
  ipcMain.handle("getPlatform", () => process.platform as "darwin" | "win32" | "linux");
  ipcMain.handle("openSystemLoginItemsSettings", () => openSystemStartupSettings());
  ipcMain.handle("whoami", async () => {
    const r = await arenaWhoami();
    if (r.ok) return { ok: true as const, data: r.data };
    return { ok: false as const, message: r.message, exitCode: r.exitCode };
  });
  ipcMain.handle(
    "createChannel",
    async (_e, payload: { title: string; visibility: "public" | "private" | "closed" }) => {
      const r = await arenaChannelCreate(payload.title, payload.visibility);
      if (r.ok) {
        const slug = extractChannelSlug(r.data);
        return { ok: true as const, slug, data: r.data };
      }
      return {
        ok: false as const,
        message: r.message,
        exitCode: r.exitCode,
      };
    },
  );
  ipcMain.handle("pickWatchFolder", async (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const opts: OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      securityScopedBookmarks: process.platform === "darwin",
    };
    const r =
      w && !w.isDestroyed()
        ? await dialog.showOpenDialog(w, opts)
        : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { canceled: true as const };
    const bookmark =
      process.platform === "darwin" && r.bookmarks?.[0]
        ? r.bookmarks[0]
        : undefined;
    return {
      canceled: false as const,
      path: r.filePaths[0],
      bookmark,
    };
  });
  ipcMain.handle("startWatcher", async () => startWatcherFromConfig());
  ipcMain.handle("stopWatcher", async () => {
    await stopWatcher();
    return { ok: true as const };
  });
  ipcMain.handle("watcherStatus", () => ({
    running: folderWatcher.isRunning(),
  }));
  ipcMain.handle("runArenaCli", async (_e, line: string) => runArenaCliLine(line));
  ipcMain.handle("listMyChannels", async () => listMyChannelsFromCli());
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: "Watchtower",
    applicationVersion: app.getVersion(),
    copyright: "Uploads use the official Are.na CLI (arena).",
  });
  registerIpc();
  syncNativeChromeTheme(getConfig().theme);
  syncLoginItemFromConfig();
  buildApplicationMenu();
  scheduleDockIconRetries();
  createTray();
  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("before-quit", () => {
  void stopWatcher();
});
