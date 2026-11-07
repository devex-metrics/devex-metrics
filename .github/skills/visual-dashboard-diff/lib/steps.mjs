/**
 * Replays declared UI steps on a rendered dashboard page.
 *
 * A step is `{ "click": "<selector>" }`, `{ "select": "<selector>", "value"?: "<option>" }`,
 * `{ "type": "<selector>", "text": "..." }` (fill a text input) or
 * `{ "press": "<key>" }` (keyboard). This module only drives the page; what
 * to conclude from a step — a screenshot, an error — is the caller's business.
 */

/**
 * Runs inside the page. Picks the value a `select` step should switch to: the
 * declared one, or the first enabled option that is not already selected.
 */
const PICK_OPTION = ([selector, wanted]) => {
  const el = document.querySelector(selector);
  if (!el) return { missing: true };
  const options = Array.from(el.options).filter((o) => !o.disabled);
  if (wanted !== null && wanted !== undefined) {
    return options.some((o) => o.value === wanted) ? { value: wanted } : { unavailable: true };
  }
  const next = options.find((o) => o.value !== el.value);
  return next ? { value: next.value } : { noop: true };
};

/**
 * Runs inside the page. "Showing" means present *and* rendered — not
 * `display:none`, not `visibility:hidden`, not zero-sized.
 */
const IS_SHOWING = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
};

export function describeStep(step) {
  if (step.click) return `click ${step.click}`;
  if (step.type) return `type "${step.text ?? ""}" into ${step.type}`;
  if (step.press) return `press ${step.press}`;
  return `select ${step.select}${step.value ? ` = ${step.value}` : ""}`;
}

const firstLine = (error) => String((error && error.message) || error).split("\n")[0];

/**
 * Applies one step. Resolves to `null` on success or a short reason string on
 * failure; never throws for an ordinary "control not there" case.
 */
export async function applyStep(page, step) {
  if (step.click) {
    try {
      await page.locator(step.click).first().click({ timeout: 2000, noWaitAfter: true });
      return null;
    } catch (error) {
      return `could not click: ${firstLine(error)}`;
    }
  }
  if (step.type) {
    try {
      await page.locator(step.type).first().fill(String(step.text ?? ""), { timeout: 2000 });
      return null;
    } catch (error) {
      return `could not type: ${firstLine(error)}`;
    }
  }
  if (step.press) {
    try {
      await page.keyboard.press(step.press);
      return null;
    } catch (error) {
      return `could not press: ${firstLine(error)}`;
    }
  }
  if (step.select) {
    const pick = await page.evaluate(PICK_OPTION, [step.select, step.value ?? null]);
    if (pick.missing) return "the select is not on screen";
    if (pick.unavailable) return `option '${step.value}' is not offered`;
    if (pick.noop) return null;
    try {
      await page.selectOption(step.select, pick.value, { timeout: 2000 });
      return null;
    } catch (error) {
      return `could not change: ${firstLine(error)}`;
    }
  }
  return 'step has none of "click", "select", "type" or "press"';
}

/**
 * Applies every step in order, stopping at the first failure.
 *
 * @returns {{ ok: true } | { ok: false, step: string, reason: string }}
 */
export async function applySteps(page, steps, { pauseMs = 120 } = {}) {
  for (const step of steps || []) {
    const reason = await applyStep(page, step);
    if (reason) return { ok: false, step: describeStep(step), reason };
    await page.waitForTimeout(pauseMs);
  }
  return { ok: true };
}

/** True when `selector` is present and rendered on the page. */
export function isShowing(page, selector) {
  return page.evaluate(IS_SHOWING, selector);
}
