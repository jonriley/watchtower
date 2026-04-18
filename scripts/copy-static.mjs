import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const pairs = [
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/preferences.html", "dist/renderer/preferences.html"],
  ["src/renderer/styles.css", "dist/renderer/styles.css"],
  ["assets/trayTemplate.png", "dist/assets/trayTemplate.png"],
  ["assets/watchtower-mark.svg", "dist/renderer/watchtower-mark.svg"],
  ["src/renderer/locales/prefs.json", "dist/renderer/locales/prefs.json"],
];
const optionalPairs = [["assets/icon.png", "dist/assets/icon.png"]];
for (const [relSrc, relDest] of pairs) {
  const absSrc = join(root, relSrc);
  const absDest = join(root, relDest);
  mkdirSync(dirname(absDest), { recursive: true });
  copyFileSync(absSrc, absDest);
}
for (const [relSrc, relDest] of optionalPairs) {
  const absSrc = join(root, relSrc);
  if (!existsSync(absSrc)) continue;
  const absDest = join(root, relDest);
  mkdirSync(dirname(absDest), { recursive: true });
  copyFileSync(absSrc, absDest);
}
