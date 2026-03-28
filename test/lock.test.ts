import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

const LOCK_DIR = path.join(os.homedir(), ".clancey");
const LOCK_FILE = path.join(LOCK_DIR, "indexer.lock");

/**
 * Write a stale lock file containing a PID that is guaranteed to be dead.
 * PID 2147483647 (max 32-bit signed int) is virtually never a real process.
 */
function writeStaleLock() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.writeFileSync(LOCK_FILE, "2147483647\n");
}

function cleanupLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {}
}

function spawnWorker(script: string): ReturnType<typeof Bun.spawn> {
  const tmpScript = path.join(os.tmpdir(), `clancey-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(tmpScript, script);
  const proc = Bun.spawn(["bun", "run", tmpScript], {
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  // Clean up script after process exits
  proc.exited.then(() => { try { fs.unlinkSync(tmpScript); } catch {} });
  return proc;
}

describe("tryAcquireIndexerLock", () => {
  beforeEach(() => cleanupLock());
  afterAll(() => cleanupLock());

  test("exactly one process wins when racing to replace a stale lock", async () => {
    writeStaleLock();

    // Spawn 5 concurrent child processes that each try to acquire the lock.
    // Each child prints "acquired" or "not-acquired" and exits.
    const srcDir = path.resolve(import.meta.dir, "../src");
    const workerScript = `
      import { tryAcquireIndexerLock } from "${srcDir}/lock.ts";
      const result = tryAcquireIndexerLock();
      process.stdout.write(result ? "acquired" : "not-acquired");
    `;

    const tmpScript = path.join(os.tmpdir(), "clancey-lock-race-worker.ts");
    fs.writeFileSync(tmpScript, workerScript);

    const count = 5;
    const procs = Array.from({ length: count }, () =>
      Bun.spawn(["bun", "run", tmpScript], {
        cwd: path.join(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe",
      })
    );

    const results = await Promise.all(
      procs.map(async (p) => {
        const out = await new Response(p.stdout).text();
        return out.trim();
      })
    );

    fs.unlinkSync(tmpScript);

    const acquired = results.filter((r) => r === "acquired").length;
    const notAcquired = results.filter((r) => r === "not-acquired").length;

    expect(acquired).toBe(1);
    expect(notAcquired).toBe(count - 1);
  });
});

describe("onIndexerExit", () => {
  beforeEach(() => cleanupLock());
  afterAll(() => cleanupLock());

  test("callbacks fire exactly once on SIGINT", async () => {
    // Write callback invocation count to a temp file so we can read it
    // after the process exits (stdout timing is unreliable with exit events).
    const countFile = path.join(os.tmpdir(), `clancey-exit-count-${Date.now()}`);
    const srcDir = path.resolve(import.meta.dir, "../src");
    const proc = spawnWorker(`
      import { tryAcquireIndexerLock, onIndexerExit } from "${srcDir}/lock.ts";
      import fs from "fs";
      let count = 0;
      tryAcquireIndexerLock();
      onIndexerExit(() => {
        count++;
        fs.writeFileSync("${countFile}", String(count));
      });
      process.kill(process.pid, "SIGINT");
    `);

    await proc.exited;
    const count = parseInt(fs.readFileSync(countFile, "utf-8").trim(), 10);
    fs.unlinkSync(countFile);
    expect(count).toBe(1);
  });
});
