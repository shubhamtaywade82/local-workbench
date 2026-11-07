#!/usr/bin/env node
// Refreshes vendor/archify from an archify checkout.
//
// The workbench renders Archify diagrams with the same zero-dependency Node
// runtime that the Archify Skill ships. This script copies only the runtime
// subset (no examples, docs, recipes or migrations) and records the upstream
// version and commit in vendor/archify/VENDOR.json, so every update is
// reproducible and reviewable.
//
// Usage:
//   node scripts/sync-archify.mjs --from /path/to/tt-a1i/archify
//   node scripts/sync-archify.mjs --from /path/to/tt-a1i/archify --check

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.join(repoRoot, "vendor", "archify");

// Runtime subset. Everything here is imported by bin/archify.mjs or by the
// renderers it spawns; examples, docs, recipes, references, migrations and
// delta are authoring material and stay upstream.
const RUNTIME_ENTRIES = [
  "bin",
  "renderers",
  "scripts",
  "explainer",
  "schemas",
  "locales",
  "assets",
  "brand-marks",
  "package.json",
  "skill-release.json",
  "LICENSE",
  "LICENSE-MIT",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
];

const SKIP_NAMES = new Set(["node_modules", ".DS_Store"]);

// Authoring-time generators and maintainer tools. They import upstream devDependencies
// (ajv, simple-icons) and are never executed by the render path.
const SKIP_RELATIVE = new Set([
  "scripts/generate-validators.mjs",
  "scripts/generate-brand-marks.mjs",
  "scripts/render-examples.mjs",
  "scripts/update-contract.mjs",
]);

function parseArgs(argv) {
  const args = { from: undefined, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--from") args.from = argv[++i];
    else if (argv[i] === "--check") args.check = true;
    else throw new Error(`Unknown argument "${argv[i]}".`);
  }
  if (!args.from) throw new Error("Pass --from <path to the archify checkout>.");
  return args;
}

function readSkillRelease(skillDir) {
  const release = JSON.parse(fs.readFileSync(path.join(skillDir, "skill-release.json"), "utf8"));
  if (release.skillId !== "archify" || typeof release.version !== "string") {
    throw new Error(`${skillDir} is not an Archify Skill checkout.`);
  }
  return release;
}

function upstreamCommit(checkout) {
  try {
    return execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function listFiles(dir, relative = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const rel = path.join(relative, entry.name);
    if (SKIP_RELATIVE.has(rel.split(path.sep).join("/"))) continue;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else if (entry.isFile()) out.push(rel);
    else throw new Error(`Refusing non-regular entry in the runtime subset: ${rel}`);
  }
  return out.sort();
}

function copyRuntime(skillDir, destination) {
  for (const name of RUNTIME_ENTRIES) {
    const from = path.join(skillDir, name);
    const to = path.join(destination, name);
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in runtime subset: ${name}`);
    if (stat.isDirectory()) {
      fs.cpSync(from, to, {
        recursive: true,
        dereference: false,
        filter: (src) => {
          if (SKIP_NAMES.has(path.basename(src))) return false;
          return !SKIP_RELATIVE.has(path.relative(skillDir, src).split(path.sep).join("/"));
        },
      });
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function describeRuntime(root) {
  const files = RUNTIME_ENTRIES.flatMap((name) => {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) throw new Error(`Missing runtime entry: ${name}`);
    return fs.statSync(full).isDirectory() ? listFiles(root, name) : [name];
  });
  return files;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkout = path.resolve(args.from);
  const skillDir = path.join(checkout, "archify");
  const release = readSkillRelease(skillDir);
  const commit = upstreamCommit(checkout);
  const manifest = {
    skillId: "archify",
    version: release.version,
    channel: release.channel,
    source: release.source?.repository ?? "https://github.com/tt-a1i/archify",
    commit,
    license: "Apache-2.0 (see LICENSE, NOTICE, THIRD_PARTY_NOTICES.md)",
    entries: RUNTIME_ENTRIES,
  };

  if (args.check) {
    if (!fs.existsSync(path.join(targetRoot, "VENDOR.json"))) {
      throw new Error("vendor/archify/VENDOR.json is missing. Run the sync without --check.");
    }
    const staging = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "archify-check-"));
    try {
      copyRuntime(skillDir, staging);
      const expected = describeRuntime(staging).map((rel) => {
        return [rel, fs.readFileSync(path.join(staging, rel)).toString("base64")];
      });
      const actual = describeRuntime(targetRoot).map((rel) => {
        return [rel, fs.readFileSync(path.join(targetRoot, rel)).toString("base64")];
      });
      const same = JSON.stringify(expected) === JSON.stringify(actual);
      const recorded = JSON.parse(fs.readFileSync(path.join(targetRoot, "VENDOR.json"), "utf8"));
      if (!same || recorded.version !== manifest.version) {
        console.error("vendor/archify is out of date. Run scripts/sync-archify.mjs --from <checkout>.");
        process.exitCode = 1;
        return;
      }
      console.log(`vendor/archify matches Archify ${recorded.version}${recorded.commit ? ` (${recorded.commit.slice(0, 12)})` : ""}.`);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    return;
  }

  const staging = fs.mkdtempSync(path.join(path.dirname(targetRoot), ".archify-sync-"));
  try {
    copyRuntime(skillDir, staging);
    fs.writeFileSync(path.join(staging, "VENDOR.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.renameSync(staging, targetRoot);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  const files = describeRuntime(targetRoot);
  console.log(`Vendored Archify ${manifest.version}${commit ? ` (${commit.slice(0, 12)})` : ""}: ${files.length} files in vendor/archify.`);
}

try {
  main();
} catch (error) {
  console.error(`sync-archify: ${error.message}`);
  process.exitCode = 1;
}
