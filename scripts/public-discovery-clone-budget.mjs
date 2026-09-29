import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

function isMissing(error) {
  return error !== null && typeof error === "object" && error.code === "ENOENT";
}

function isActivePath(file, activeTarget) {
  return activeTarget && (file === activeTarget || file.startsWith(activeTarget + path.sep));
}

function diskBytes(folder, activeTarget, files) {
  let entries;
  try {
    entries = files.readdirSync(folder, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error) && isActivePath(folder, activeTarget)) return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) total += diskBytes(file, activeTarget, files);
    else if (entry.isFile()) {
      try {
        total += files.statSync(file).size;
      } catch (error) {
        if (!isMissing(error) || !isActivePath(file, activeTarget)) throw error;
      }
    }
  }
  return total;
}

export function createCloneBudget(
  root,
  maxSizeKb,
  maxTotalSizeKb,
  maxMinutes,
  now = () => performance.now(),
  files = fs
) {
  if (![maxSizeKb, maxTotalSizeKb, maxMinutes].every(Number.isSafeInteger) ||
      maxSizeKb < 0 || maxTotalSizeKb < 1 || maxMinutes < 1 ||
      maxSizeKb > Math.floor(Number.MAX_SAFE_INTEGER / 2048) ||
      maxMinutes > 360 ||
      maxTotalSizeKb > Math.floor(Number.MAX_SAFE_INTEGER / 1024)) {
    throw new Error("Invalid public discovery clone budget");
  }
  const started = now();
  const totalBytes = maxTotalSizeKb * 1024;
  const totalMilliseconds = maxMinutes * 60_000;

  function remainingMs() {
    return totalMilliseconds - (now() - started);
  }

  function check(target, active = false) {
    if (remainingMs() <= 0)
      throw new Error(`Public discovery clone deadline exceeded (${maxMinutes} minutes total)`);
    const used = diskBytes(root, active ? target : undefined, files);
    if (remainingMs() <= 0)
      throw new Error(`Public discovery clone deadline exceeded (${maxMinutes} minutes total)`);
    if (used > totalBytes)
      throw new Error(`Public discovery clone directory exceeded ${totalBytes} bytes total`);
    if (
      maxSizeKb &&
      files.existsSync(target) &&
      diskBytes(target, active ? target : undefined, files) > maxSizeKb * 1024 * 2
    )
      throw new Error(`Full-history checkout exceeded ${maxSizeKb * 2048} bytes per repository`);
  }

  return { check, remainingMs };
}
