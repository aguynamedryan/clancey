import fs from "fs";
import path from "path";
import os from "os";
import { log } from "./logger.js";

const LOCK_DIR = path.join(os.homedir(), ".clancey");
const LOCK_FILE = path.join(LOCK_DIR, "indexer.lock");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to become the indexer instance. Returns true if this process
 * acquired the lock (and should run indexing + watcher). Returns false
 * if another live Clancey instance already holds the lock.
 */
const onExitCallbacks: Array<() => void> = [];

/** Register a callback to run when the indexer process exits (SIGINT/SIGTERM). */
export function onIndexerExit(callback: () => void): void {
  onExitCallbacks.push(callback);
}

export function tryAcquireIndexerLock(): boolean {
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  } catch {
    // ignore
  }

  const cleanup = () => {
    try {
      const content = fs.readFileSync(LOCK_FILE, "utf-8").trim();
      if (parseInt(content, 10) === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    } catch {
      // ignore
    }
  };

  const registerCleanup = () => {
    const exitHandler = () => {
      for (const cb of onExitCallbacks) {
        try { cb(); } catch {}
      }
      cleanup();
    };
    process.on("exit", exitHandler);
    process.on("SIGINT", () => { exitHandler(); process.exit(0); });
    process.on("SIGTERM", () => { exitHandler(); process.exit(0); });
  };

  const acquire = (): boolean => {
    fs.writeFileSync(LOCK_FILE, `${process.pid}\n`, { flag: "wx" });
    log(`Acquired indexer lock (PID ${process.pid})`);
    registerCleanup();
    return true;
  };

  try {
    return acquire();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EEXIST") {
      log(`Failed to write lock file: ${error}`);
      return false;
    }

    try {
      const content = fs.readFileSync(LOCK_FILE, "utf-8").trim();
      const pid = parseInt(content, 10);
      if (!isNaN(pid) && pid !== process.pid && isProcessAlive(pid)) {
        log(`Another Clancey indexer is running (PID ${pid}). This instance will be search-only.`);
        return false;
      }
      log(`Removing stale lock from PID ${pid}`);
      // Atomically replace the lock file to avoid TOCTOU race:
      // 1. Write our PID to a temp file
      // 2. Rename it over the lock (atomic on POSIX)
      // 3. Wait briefly for any concurrent racers to finish their renames
      // 4. Re-read — the last rename wins, so only one PID survives
      const tmpFile = `${LOCK_FILE}.${process.pid}`;
      fs.writeFileSync(tmpFile, `${process.pid}\n`);
      fs.renameSync(tmpFile, LOCK_FILE);

      // Allow other racing renames to settle
      const start = Date.now();
      while (Date.now() - start < 50) {}

      const winner = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      if (winner !== process.pid) {
        log(`Lost lock race to PID ${winner}. This instance will be search-only.`);
        return false;
      }
      log(`Acquired indexer lock (PID ${process.pid})`);
      registerCleanup();
      return true;
    } catch (staleLockError) {
      log(`Failed to recover stale lock file: ${staleLockError}`);
      return false;
    }
  }
}
