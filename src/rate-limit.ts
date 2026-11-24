/**
 * Recognise a GitHub rate-limit failure that `@octokit/plugin-throttling` gave
 * up on after its retries.
 *
 * GitHub reports both the primary and the secondary limit as HTTP 403 (or
 * 429), the same status as a genuine permission problem. A collector that
 * reads every 403 as "access denied" would therefore turn an exhausted rate
 * limit into zeros, so every 403 handler must check this first.
 */
export function isRateLimitError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    status?: number;
    message?: unknown;
    errors?: unknown;
    data?: { errors?: unknown; message?: unknown } | null;
    response?: {
      headers?: Record<string, string | number | undefined>;
      data?: { errors?: unknown; message?: unknown } | null;
    };
  };

  if (e.status === 429) return true;

  const graphqlErrors = [e.errors, e.data?.errors, e.response?.data?.errors].flatMap((list) =>
    Array.isArray(list) ? (list as Array<{ type?: unknown }>) : []
  );
  if (graphqlErrors.some((g) => g?.type === "RATE_LIMITED")) return true;

  if (e.status !== 403) return false;
  if (String(e.response?.headers?.["x-ratelimit-remaining"]) === "0") return true;
  const messages = [e.message, e.data?.message, e.response?.data?.message];
  return messages.some((m) => typeof m === "string" && /rate limit/i.test(m));
}
