/**
 * Derive a total item count from a GitHub list response made with
 * `per_page=1`.
 *
 * When a list endpoint returns more than one page the response contains a
 * `Link` header whose `rel="last"` URL includes a `page` query-param equal
 * to the total number of items.
 *
 * If there is no `Link` header the total equals the number of items in the
 * response body (0 or 1).
 */
export function getCountFromLinkHeader(
  response: { headers: { link?: string }; data: unknown[] }
): number {
  const link = response.headers.link;
  if (!link) {
    return response.data.length;
  }
  const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? parseInt(match[1], 10) : response.data.length;
}
