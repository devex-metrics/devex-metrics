/**
 * Convert an arbitrary group/dataset display name (e.g. "My Team") into a
 * filesystem- and URL-safe key used to name its cache file and its build
 * output folder (e.g. "my-team").
 */
export function slugifyDatasetKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "group";
}
