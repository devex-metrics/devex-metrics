import type { RepoCollectionState, RepoCollectionWarning } from "./types.js";

/** Short label for a repository's collection gap, shared by the report and dashboard. */
export function collectionStateLabel(state: RepoCollectionState): string {
  switch (state) {
    case "capped":
      return "PR history capped";
    case "partial":
      return "Partial data";
    case "rest-fallback":
      return "REST fallback";
    case "stale":
      return "Not refreshed";
    case "failed":
      return "No data";
  }
}

/** Explain period coverage without claiming older, undated caps are harmless. */
export function collectionWarningDetail(warning: RepoCollectionWarning): string {
  if (warning.state !== "capped") return warning.detail;
  return warning.detail + (warning.completeSince
    ? ` Coverage is complete only after ${warning.completeSince}; the selected period overlaps the cap.`
    : " The cap date is unknown in this snapshot; refresh collection to determine period coverage.");
}
