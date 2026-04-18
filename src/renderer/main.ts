import type { ChannelListItem, ThemePreference } from "../shared/types.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
}

const channelSelect = $<HTMLSelectElement>("channelSelect");
const refreshChannelsBtn = $<HTMLButtonElement>("refreshChannels");
const newChannelTitle = $<HTMLInputElement>("newChannelTitle");
const newChannelVisibility = $<HTMLSelectElement>("newChannelVisibility");
const createChannelBtn = $<HTMLButtonElement>("createChannel");
const whoamiBtn = $<HTMLButtonElement>("whoami");
const startBtn = $<HTMLButtonElement>("start");
const stopBtn = $<HTMLButtonElement>("stop");
const statusEl = $<HTMLSpanElement>("status");
const logEl = $<HTMLUListElement>("log");
const cliInput = $<HTMLInputElement>("cliInput");
const cliRun = $<HTMLButtonElement>("cliRun");
const cliClear = $<HTMLButtonElement>("cliClear");
const cliOutput = $<HTMLPreElement>("cliOutput");
const clearLogBtn = $<HTMLButtonElement>("clearLog");
const helpBtn = $<HTMLButtonElement>("helpBtn");
const helpDialog = $<HTMLDialogElement>("helpDialog");
const helpClose = $<HTMLButtonElement>("helpClose");

function setStatus(text: string) {
  statusEl.textContent = text;
}

function appendLogLine(entry: {
  at: string;
  level: string;
  message: string;
  file?: string;
}) {
  const li = document.createElement("li");
  li.className = entry.level;
  const time = document.createElement("span");
  time.className = "t";
  time.textContent = new Date(entry.at).toLocaleTimeString();
  const msg = document.createElement("span");
  msg.className = "m";
  msg.textContent = entry.file
    ? `${entry.message} — ${entry.file}`
    : entry.message;
  li.append(time, msg);
  logEl.prepend(li);
  while (logEl.children.length > 200) {
    logEl.removeChild(logEl.lastChild!);
  }
}

function fillChannelSelect(channels: ChannelListItem[], selectedSlug: string): void {
  const slug = selectedSlug.trim() || "clutter";
  channelSelect.innerHTML = "";
  const slugs = new Set(channels.map((c) => c.slug));
  if (!slugs.has(slug)) {
    const o = document.createElement("option");
    o.value = slug;
    o.textContent = `${slug} (saved)`;
    channelSelect.append(o);
  }
  for (const c of channels) {
    const o = document.createElement("option");
    o.value = c.slug;
    o.textContent = c.title === c.slug ? c.slug : `${c.title} (${c.slug})`;
    channelSelect.append(o);
  }
  channelSelect.value = slug;
  if (channelSelect.value !== slug) {
    const o = document.createElement("option");
    o.value = slug;
    o.textContent = slug;
    channelSelect.append(o);
    channelSelect.value = slug;
  }
}

async function loadChannelDropdown(): Promise<void> {
  refreshChannelsBtn.disabled = true;
  try {
    const c = await window.arenaWatcher.getConfig();
    const selected = (c.channelSlugOrId || "clutter").trim() || "clutter";
    const r = await window.arenaWatcher.listMyChannels();
    if (!r.ok) {
      fillChannelSelect([], selected);
      setStatus(r.message);
      return;
    }
    fillChannelSelect(r.channels, selected);
  } finally {
    refreshChannelsBtn.disabled = false;
  }
}

async function refreshConfigUi() {
  const c = await window.arenaWatcher.getConfig();
  applyTheme(c.theme);
  const s = await window.arenaWatcher.watcherStatus();
  setStatus(s.running ? "Watcher running" : "Watcher stopped");
  await loadChannelDropdown();
}

async function refreshLogs() {
  const logs = await window.arenaWatcher.getLogs();
  logEl.innerHTML = "";
  for (const e of [...logs].reverse()) appendLogLine(e);
}

channelSelect.addEventListener("change", async () => {
  const slug = channelSelect.value.trim() || "clutter";
  await window.arenaWatcher.setConfig({ channelSlugOrId: slug });
  setStatus(`Channel set to ${slug} (saved).`);
});

refreshChannelsBtn.addEventListener("click", () => {
  void loadChannelDropdown().then(() => {
    setStatus("Channel list refreshed.");
  });
});

whoamiBtn.addEventListener("click", async () => {
  const r = await window.arenaWatcher.whoami();
  if (r.ok) {
    setStatus("Logged in.");
    appendLogLine({
      at: new Date().toISOString(),
      level: "success",
      message: `whoami: ${JSON.stringify(r.data)}`,
    });
  } else {
    setStatus(r.message);
    appendLogLine({
      at: new Date().toISOString(),
      level: "error",
      message: `whoami failed: ${r.message}`,
    });
  }
});

createChannelBtn.addEventListener("click", async () => {
  const title = newChannelTitle.value.trim();
  if (!title) {
    setStatus("Enter a channel title.");
    return;
  }
  const visibility = newChannelVisibility.value as "public" | "private" | "closed";
  const r = await window.arenaWatcher.createChannel({ title, visibility });
  if (r.ok) {
    const slug = r.slug ?? "";
    if (slug) {
      await window.arenaWatcher.setConfig({ channelSlugOrId: slug });
      await loadChannelDropdown();
    }
    setStatus(r.slug ? `Created channel; slug: ${r.slug}` : "Created channel (no slug in response).");
    appendLogLine({
      at: new Date().toISOString(),
      level: "success",
      message: `channel create: ${slug || JSON.stringify(r.data)}`,
    });
  } else {
    setStatus(r.message);
    appendLogLine({
      at: new Date().toISOString(),
      level: "error",
      message: `channel create failed: ${r.message}`,
    });
  }
});

startBtn.addEventListener("click", async () => {
  const r = await window.arenaWatcher.startWatcher();
  if (r.ok) setStatus("Watcher running");
  else setStatus(r.message);
});

stopBtn.addEventListener("click", async () => {
  await window.arenaWatcher.stopWatcher();
  setStatus("Watcher stopped");
});

function appendCliBlock(text: string) {
  cliOutput.textContent += text;
  cliOutput.scrollTop = cliOutput.scrollHeight;
}

async function runCliFromInput() {
  const cmd = cliInput.value.trim();
  if (!cmd) return;
  cliRun.disabled = true;
  appendCliBlock(`$ ${cmd}\n`);
  try {
    const r = await window.arenaWatcher.runArenaCli(cmd);
    if (!r.ok) {
      appendCliBlock(`${r.error}\n---\n`);
      return;
    }
    const bits: string[] = [];
    bits.push(`exit ${r.code ?? "?"}\n`);
    if (r.stdout) bits.push(r.stdout.endsWith("\n") ? r.stdout : `${r.stdout}\n`);
    if (r.stderr) {
      bits.push("--- stderr ---\n");
      bits.push(r.stderr.endsWith("\n") ? r.stderr : `${r.stderr}\n`);
    }
    bits.push("---\n");
    appendCliBlock(bits.join(""));
  } finally {
    cliRun.disabled = false;
  }
}

cliRun.addEventListener("click", () => {
  void runCliFromInput();
});

cliClear.addEventListener("click", () => {
  cliOutput.textContent = "";
  cliInput.value = "";
  cliInput.focus();
});

cliInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void runCliFromInput();
  }
});

window.arenaWatcher.onLog((entry) => {
  appendLogLine(entry);
  void window.arenaWatcher.watcherStatus().then((s) => {
    setStatus(s.running ? "Watcher running" : "Watcher stopped");
  });
});

window.arenaWatcher.onLogsCleared(() => {
  logEl.innerHTML = "";
});

clearLogBtn.addEventListener("click", async () => {
  await window.arenaWatcher.clearLogs();
  logEl.innerHTML = "";
  setStatus("Activity cleared.");
});

window.arenaWatcher.onThemeFromMain((theme) => {
  applyTheme(theme);
});

helpBtn.addEventListener("click", () => {
  helpDialog.showModal();
});

helpClose.addEventListener("click", () => {
  helpDialog.close();
});

helpDialog.addEventListener("click", (e) => {
  if (e.target === helpDialog) helpDialog.close();
});

void refreshConfigUi();
void refreshLogs();
