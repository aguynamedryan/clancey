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

  const acquire = (): boolean => {
    fs.writeFileSync(LOCK_FILE, `${process.pid}\n`, { flag: "wx" });
    log(`Acquired indexer lock (PID ${process.pid})`);
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
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
      fs.unlinkSync(LOCK_FILE);
      return acquire();
    } catch (staleLockError) {
      log(`Failed to recover stale lock file: ${staleLockError}`);
      return false;
    }
  }
}
