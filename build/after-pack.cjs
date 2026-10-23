// electron-builder hook, run after the app folder is assembled and before any
// installer is produced. Copies the Next.js standalone server, with its own
// node_modules, into the packaged app. electron-builder's file rules drop nested
// node_modules and dot-directories, so a plain copy is the reliable route.

const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  // The packaging driver sets this to the repository's .next/standalone folder.
  const standalone = process.env.LOCAL_WORKBENCH_STANDALONE;
  if (!standalone) throw new Error("LOCAL_WORKBENCH_STANDALONE is not set; run the packaging through scripts/package-desktop.mjs");
  if (!existsSync(path.join(standalone, "server.js"))) {
    throw new Error(`${standalone}/server.js is missing; run "bun run desktop:build" first`);
  }

  const { appOutDir, packager } = context;
  const resources =
    packager.platform.name === "mac"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");

  cpSync(standalone, path.join(resources, "app", ".next", "standalone"), { recursive: true });
};
