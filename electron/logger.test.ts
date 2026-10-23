import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RotatingLog } from "./logger";

describe("RotatingLog", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "lw-log-"));
    file = path.join(dir, "logs", "desktop.log");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates the directory and appends one line per write", () => {
    const log = new RotatingLog(file);
    log.write("first");
    log.write("second\n");
    expect(readFileSync(file, "utf8")).toBe("first\nsecond\n");
  });

  test("rotates when the file reaches the size limit and keeps the configured number of files", () => {
    const log = new RotatingLog(file, 20, 2);
    log.write("a".repeat(25)); // written: file starts empty
    log.write("b".repeat(25)); // rotates "a" into .1
    log.write("c".repeat(25)); // rotates "b" into .1, "a" into .2
    log.write("d".repeat(25)); // rotates "c" into .1, "b" into .2, "a" is discarded
    expect(readFileSync(file, "utf8")).toBe(`${"d".repeat(25)}\n`);
    expect(readFileSync(`${file}.1`, "utf8")).toBe(`${"c".repeat(25)}\n`);
    expect(readFileSync(`${file}.2`, "utf8")).toBe(`${"b".repeat(25)}\n`);
    expect(existsSync(`${file}.3`)).toBe(false);
  });

  test("rotation moves existing numbered files up when some slots are empty", () => {
    mkdirSync(path.dirname(file), { recursive: true });
    const log = new RotatingLog(file, 10, 3);
    writeFileSync(`${file}.2`, "old");
    log.write("x".repeat(12));
    log.write("y".repeat(12));
    expect(readFileSync(`${file}.3`, "utf8")).toBe("old");
    expect(readFileSync(`${file}.1`, "utf8")).toBe(`${"x".repeat(12)}\n`);
    expect(readFileSync(file, "utf8")).toBe(`${"y".repeat(12)}\n`);
    expect(existsSync(`${file}.2`)).toBe(false);
  });

  test("never throws, even when the location cannot be written", () => {
    const blocker = path.join(dir, "not-a-directory");
    writeFileSync(blocker, "x");
    const log = new RotatingLog(path.join(blocker, "desktop.log"));
    expect(() => log.write("dropped")).not.toThrow();
  });
});
