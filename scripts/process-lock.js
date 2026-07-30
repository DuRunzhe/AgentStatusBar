'use strict';

const fs = require('fs');

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireProcessLock(lockFile, pid = process.pid, processIsRunning = isProcessRunning) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockFile, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${pid}\n`);
      fs.closeSync(descriptor);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const owner = Number.parseInt(fs.readFileSync(lockFile, 'utf8'), 10);
          if (owner === pid) fs.unlinkSync(lockFile);
        } catch {
          // The lock was already removed or replaced.
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;

      let owner = 0;
      try {
        owner = Number.parseInt(fs.readFileSync(lockFile, 'utf8'), 10);
      } catch {
        // Treat unreadable lock files as stale.
      }
      if (processIsRunning(owner)) return null;

      try {
        fs.unlinkSync(lockFile);
      } catch (unlinkError) {
        if (unlinkError?.code !== 'ENOENT') return null;
      }
    }
  }
  return null;
}

module.exports = { acquireProcessLock, isProcessRunning };
