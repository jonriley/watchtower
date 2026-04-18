# Are.na folder watcher

Electron app that watches a folder on your computer and uploads each new file to an [Are.na](https://are.na) channel using the official [`@aredotna/cli`](https://github.com/aredotna/cli).

## Prerequisites

- Node.js 20+
- The `arena` CLI on your `PATH`:

  ```bash
  npm install -g @aredotna/cli
  ```

- A one-time login so the CLI can talk to the API:

  ```bash
  arena login
  ```

The app does not store Are.na credentials itself; it shells out to `arena upload`.

## Run from source

```bash
npm install
npm start
```

This compiles TypeScript into `dist/` and launches Electron.

## Usage

1. Use **Appearance** (System / Light / Dark) to match Are.na’s high-contrast look; the choice is saved with your settings and updates the window chrome where supported.
2. Click **Choose…** and pick the folder to watch (on macOS, the folder picker stores a security-scoped bookmark so access can persist across launches).
3. Enter the **channel slug or id** blocks should go to, or use **Create channel** (defaults to a channel titled `clutter`) and save the returned slug.
4. Click **Save settings**.
5. Use **Start watcher** / **Stop watcher**, or the menu bar tray (Show / Start / Stop / Quit).

New files dropped into the watch folder are uploaded after the file stops changing (chokidar write-finish stability). Dotfiles (names starting with `.`) are ignored.

## CLI panel

The **CLI** section runs `arena` the same way as in a terminal: type a full command (e.g. `arena whoami`, `arena ping`, `arena search "…"`) and press **Run** or Enter. **Clear** wipes the output panel and the command line. For safety, only lines that start with `arena` are executed (no arbitrary shell). Bare `arena` with no subcommand is blocked because it can wait for an interactive session.

## Tray

When the app is running, a tray icon is available with **Show**, **Start watcher**, **Stop watcher**, and **Quit**. On macOS, closing the window does not quit the app; use **Quit** from the tray or Cmd+Q from the menu when the window is focused.
