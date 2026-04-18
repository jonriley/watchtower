/**
 * Writes assets/icon.png and assets/trayTemplate.png when missing so the Dock
 * and packaged app are not stuck on the default Electron icon.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const iconPng = join(root, "assets/icon.png");
const trayPng = join(root, "assets/trayTemplate.png");

if (existsSync(iconPng) && existsSync(trayPng)) {
  process.exit(0);
}

const gen = join(root, "scripts/gen-panopticon-assets.py");
const r = spawnSync("python3", [gen], { cwd: root, stdio: "inherit" });
if (r.error) {
  console.error(
    "Could not run Python to generate icons:",
    r.error.message,
    "\nInstall Python 3, or from the project folder run: npm run icons",
  );
  process.exit(1);
}
if (r.status !== 0) {
  console.error(
    "Icon script exited with code",
    r.status,
    "\nFix the error above or run: npm run icons",
  );
  process.exit(r.status ?? 1);
}
