import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

function diskBytes(folder) {
  if (!fs.existsSync(folder)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) total += diskBytes(file);
    else if (entry.isFile()) total += fs.statSync(file).size;
  }
  return total;
}

export function createCloneBudget(root, maxSizeKb, maxTotalSizeKb, maxMinutes, now = () => performance.now()) {
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

  function check(target) {
    if (remainingMs() <= 0)
      throw new Error(`Public discovery clone deadline exceeded (${maxMinutes} minutes total)`);
    const used = diskBytes(root);
    if (remainingMs() <= 0)
      throw new Error(`Public discovery clone deadline exceeded (${maxMinutes} minutes total)`);
    if (used > totalBytes)
      throw new Error(`Public discovery clone directory exceeded ${totalBytes} bytes total`);
    if (maxSizeKb && diskBytes(target) > maxSizeKb * 1024 * 2)
      throw new Error(`Full-history checkout exceeded ${maxSizeKb * 2048} bytes per repository`);
  }

  return { check, remainingMs };
}
