import { contextBridge, ipcRenderer } from "electron";
const api = {
    getConfig: () => ipcRenderer.invoke("getConfig"),
    setConfig: (partial) => ipcRenderer.invoke("setConfig", partial),
    getLogs: () => ipcRenderer.invoke("getLogs"),
    whoami: () => ipcRenderer.invoke("whoami"),
    createChannel: (payload) => ipcRenderer.invoke("createChannel", payload),
    pickWatchFolder: () => ipcRenderer.invoke("pickWatchFolder"),
    startWatcher: () => ipcRenderer.invoke("startWatcher"),
    stopWatcher: () => ipcRenderer.invoke("stopWatcher"),
    watcherStatus: () => ipcRenderer.invoke("watcherStatus"),
    onLog: (handler) => {
        const fn = (_e, entry) => handler(entry);
        ipcRenderer.on("log", fn);
        return () => {
            ipcRenderer.removeListener("log", fn);
        };
    },
};
contextBridge.exposeInMainWorld("arenaWatcher", api);
