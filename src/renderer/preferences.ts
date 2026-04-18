import type { ThemePreference, UiLocale } from "../shared/types.js";
import {
  initPrefsI18n,
  normalizeUiLocale,
  prefT,
} from "./locales/prefs-i18n.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
}

const watchPath = $<HTMLInputElement>("watchPath");
const pickFolder = $<HTMLButtonElement>("pickFolder");
const recursive = $<HTMLInputElement>("recursive");
const save = $<HTMLButtonElement>("save");
const statusEl = $<HTMLSpanElement>("status");
const themeSelect = $<HTMLSelectElement>("theme");
const uiLocaleSelect = $<HTMLSelectElement>("uiLocale");
const openAtLoginEl = $<HTMLInputElement>("openAtLogin");
const offerTrashAfterUploadEl = $<HTMLInputElement>("offerTrashAfterUpload");
const openLoginItemsBtn = $<HTMLButtonElement>("openLoginItems");

let lastPickBookmark: string | undefined;
let currentLocale: UiLocale = "en";
let platform: "darwin" | "win32" | "linux" = "darwin";

function htmlLang(locale: UiLocale): string {
  return locale === "zh" ? "zh-Hans" : locale;
}

function applyOpenLoginButton(locale: UiLocale) {
  if (platform === "linux") {
    openLoginItemsBtn.hidden = true;
    return;
  }
  openLoginItemsBtn.hidden = false;
  openLoginItemsBtn.textContent =
    platform === "win32"
      ? prefT(locale, "openLoginWin")
      : prefT(locale, "openLoginMac");
}

function applyPrefsI18n(locale: UiLocale) {
  currentLocale = locale;
  const loc = normalizeUiLocale(locale);
  document.documentElement.lang = htmlLang(loc);
  document.documentElement.dir = loc === "ar" ? "rtl" : "ltr";
  document.title = prefT(loc, "pageTitle");

  for (const el of Array.from(document.querySelectorAll("[data-i18n]"))) {
    const key = el.getAttribute("data-i18n");
    if (!key) continue;
    el.textContent = prefT(loc, key);
  }

  themeSelect.setAttribute("aria-label", prefT(loc, "themeAria"));
  uiLocaleSelect.setAttribute("aria-label", prefT(loc, "language"));

  const optSystem = themeSelect.querySelector('option[value="system"]');
  const optLight = themeSelect.querySelector('option[value="light"]');
  const optDark = themeSelect.querySelector('option[value="dark"]');
  if (optSystem) optSystem.textContent = prefT(loc, "themeSystem");
  if (optLight) optLight.textContent = prefT(loc, "themeLight");
  if (optDark) optDark.textContent = prefT(loc, "themeDark");

  watchPath.placeholder = prefT(loc, "pickPlaceholder");
  applyOpenLoginButton(loc);
}

function setStatusMessage(key: string) {
  statusEl.textContent = prefT(currentLocale, key);
}

async function refreshConfigUi() {
  const c = await window.arenaWatcher.getConfig();
  const loc = normalizeUiLocale(c.uiLocale);
  watchPath.value = c.watchPath || "";
  recursive.checked = Boolean(c.recursive);
  openAtLoginEl.checked = Boolean(c.openAtLogin);
  offerTrashAfterUploadEl.checked = Boolean(c.offerTrashAfterUpload);
  themeSelect.value = c.theme;
  uiLocaleSelect.value = loc;
  applyTheme(c.theme);
  applyPrefsI18n(loc);
}

pickFolder.addEventListener("click", async () => {
  const r = await window.arenaWatcher.pickWatchFolder();
  if (r.canceled) return;
  lastPickBookmark = r.bookmark;
  watchPath.value = r.path;
  await window.arenaWatcher.setConfig({
    watchPath: r.path.trim(),
    ...(r.bookmark ? { watchFolderBookmark: r.bookmark } : {}),
  });
  lastPickBookmark = undefined;
  setStatusMessage("statusFolderSaved");
});

save.addEventListener("click", async () => {
  const loc = normalizeUiLocale(uiLocaleSelect.value);
  uiLocaleSelect.value = loc;
  const partial: Parameters<typeof window.arenaWatcher.setConfig>[0] = {
    watchPath: watchPath.value.trim(),
    recursive: recursive.checked,
    openAtLogin: openAtLoginEl.checked,
    offerTrashAfterUpload: offerTrashAfterUploadEl.checked,
    theme: themeSelect.value as ThemePreference,
    uiLocale: loc,
  };
  if (lastPickBookmark) partial.watchFolderBookmark = lastPickBookmark;
  await window.arenaWatcher.setConfig(partial);
  lastPickBookmark = undefined;
  applyTheme(partial.theme!);
  applyPrefsI18n(loc);
  setStatusMessage("statusSaved");
});

themeSelect.addEventListener("change", async () => {
  const theme = themeSelect.value as ThemePreference;
  applyTheme(theme);
  await window.arenaWatcher.setConfig({ theme });
});

uiLocaleSelect.addEventListener("change", async () => {
  const loc = normalizeUiLocale(uiLocaleSelect.value);
  uiLocaleSelect.value = loc;
  applyPrefsI18n(loc);
  await window.arenaWatcher.setConfig({ uiLocale: loc });
  setStatusMessage("statusSaved");
});

openAtLoginEl.addEventListener("change", async () => {
  await window.arenaWatcher.setConfig({ openAtLogin: openAtLoginEl.checked });
  setStatusMessage(
    openAtLoginEl.checked ? "statusLoginOn" : "statusLoginOff",
  );
});

offerTrashAfterUploadEl.addEventListener("change", async () => {
  await window.arenaWatcher.setConfig({
    offerTrashAfterUpload: offerTrashAfterUploadEl.checked,
  });
  setStatusMessage(
    offerTrashAfterUploadEl.checked ? "statusTrashOn" : "statusTrashOff",
  );
});

window.arenaWatcher.onThemeFromMain((theme) => {
  applyTheme(theme);
  themeSelect.value = theme;
});

window.arenaWatcher.onLocaleFromMain((locale) => {
  const loc = normalizeUiLocale(locale);
  uiLocaleSelect.value = loc;
  applyPrefsI18n(loc);
});

void (async () => {
  initPrefsI18n(await window.arenaWatcher.getPrefsBundle());
  platform = await window.arenaWatcher.getPlatform();
  await refreshConfigUi();
})();

openLoginItemsBtn.addEventListener("click", async () => {
  const r = await window.arenaWatcher.openSystemLoginItemsSettings();
  if (r.ok) setStatusMessage("statusSysOpened");
  else statusEl.textContent = r.message;
});
