// Copies the static assets and public folder next to the standalone server.
// Replaces `cp -r`, which does not exist in Windows shells.

import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

await mkdir(path.join(standalone, ".next"), { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
console.log(`copied static assets and public/ into ${path.relative(root, standalone)}/`);
