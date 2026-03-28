import * as fs from "node:fs";
import * as path from "node:path";
import type { CacheEnvelope, OrgMetrics } from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");

function cacheFilePath(owner: string): string {
  return path.join(DATA_DIR, `${owner}.json`);
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Return cached data if it was collected today, otherwise null.
 */
export function loadCache(owner: string): OrgMetrics | null {
  const filePath = cacheFilePath(owner);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const envelope: CacheEnvelope = JSON.parse(raw);
    if (envelope.date === todayDateString()) {
      return envelope.data;
    }
    return null; // stale cache
  } catch {
    return null;
  }
}

/**
 * Persist collected data with today's date stamp.
 */
export function saveCache(owner: string, data: OrgMetrics): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const envelope: CacheEnvelope = {
    date: todayDateString(),
    data,
  };
  fs.writeFileSync(cacheFilePath(owner), JSON.stringify(envelope, null, 2));
}
