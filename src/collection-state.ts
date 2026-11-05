import type { RepoCollectionState } from "./types.js";

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
