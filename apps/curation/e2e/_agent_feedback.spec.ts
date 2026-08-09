/**
 * Playwright spec — endorse / flag feedback on an agent judgement.
 *
 * Contract (shipped 2026-08-08, commits ``502636c`` / ``295c607``;
 * handoff ``AGENT_FEEDBACK_ENDPOINT_2026_08_08.md``):
 *
 *   - Two small thumbs on each boss-critic verdict. Feedback for the
 *     AGENT — it changes nothing about the design.
 *   - Optional: nothing is gated on it, and it starts unset.
 *   - Clicking the ACTIVE stance clears it, so a misclick costs one
 *     click to undo.
 *   - Attached to the FINAL verdict ONLY. Where the boss argued with
 *     itself across rounds, the superseded rounds behind "how the agent
 *     got here" carry no control — rating a position the agent already
 *     abandoned isn't useful signal. This is the part most likely to
 *     regress silently, since the history rows render the same verdict
 *     prose.
 *
 * Reuses the exp-29184 HAR the boss-critic spec already froze — that
 * recording carries a design-scope blocker plus a multi-round factor
 * verdict, which is exactly the shape this contract is about. No new
 * recording needed.
 *
 * Tagged @critical so the precommit gate runs it.
 */
import { expect, test } from "@playwright/test";
import { mockExperiment } from "./_mocks";

const TARGET = "/#/experiments/29184";
const GROUP = '[aria-label="feedback on this agent judgement"]';
const STORAGE_KEY = "gca:agent-feedback:29184";

test.describe("Agent-judgement feedback @critical", () => {
  test.beforeEach(async ({ page }) => {
    await mockExperiment(page, "exp-29184");
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1400 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    await page
      .getByText(/boss-critic review/i)
      .first()
      .waitFor({ state: "visible", timeout: 30000 });
  });

  test("every boss verdict offers the control, and it starts unset", async ({
    page,
  }) => {
    const groups = page.locator(GROUP);
    await expect(groups.first()).toBeVisible({ timeout: 10000 });
    expect(await groups.count()).toBeGreaterThan(0);

    // Optional by construction: nothing is pre-selected, so a curator
    // who ignores it has said nothing.
    const pressed = page.locator(`${GROUP} button[aria-pressed="true"]`);
    await expect(pressed).toHaveCount(0);
    await expect(
      page.locator(`${GROUP} button[aria-label="endorse this judgement"]`).first(),
    ).toBeVisible();
    await expect(
      page.locator(`${GROUP} button[aria-label="flag this judgement"]`).first(),
    ).toBeVisible();
  });

  test("flagging records the stance against the audit", async ({ page }) => {
    const flag = page
      .locator(`${GROUP} button[aria-label="flag this judgement"]`)
      .first();
    await flag.click();
    await expect(flag).toHaveAttribute("aria-pressed", "true");

    const stored = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      STORAGE_KEY,
    );
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!) as Record<
      string,
      { stance: string; judge: string; auditId: string }
    >;
    const entries = Object.values(parsed);
    expect(entries).toHaveLength(1);
    expect(entries[0].stance).toBe("flag");
    // Field is ``judge``, not ``subject`` — settled with the agents side
    // so we don't mint a third vocabulary for "which agent said this".
    expect(entries[0].judge).toBe("boss_critic");
    // Attributed to a run, or the feedback can't be acted on.
    expect(entries[0].auditId).toBeTruthy();
  });

  test("clicking the active stance again clears it — a misclick is one click to undo", async ({
    page,
  }) => {
    const flag = page
      .locator(`${GROUP} button[aria-label="flag this judgement"]`)
      .first();
    await flag.click();
    await expect(flag).toHaveAttribute("aria-pressed", "true");
    await flag.click();
    await expect(flag).toHaveAttribute("aria-pressed", "false");

    // The whole key goes, not an empty object left behind.
    const stored = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      STORAGE_KEY,
    );
    expect(stored).toBeNull();
  });

  test("switching stance replaces rather than accumulating", async ({
    page,
  }) => {
    const g = page.locator(GROUP).first();
    await g.locator('button[aria-label="flag this judgement"]').click();
    await g.locator('button[aria-label="endorse this judgement"]').click();

    await expect(
      g.locator('button[aria-label="endorse this judgement"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      g.locator('button[aria-label="flag this judgement"]'),
    ).toHaveAttribute("aria-pressed", "false");

    const count = await page.evaluate((k) => {
      const raw = window.localStorage.getItem(k);
      return raw ? Object.keys(JSON.parse(raw) as object).length : 0;
    }, STORAGE_KEY);
    expect(count).toBe(1);
  });

  test("the round history carries NO control — feedback is on the final verdict only", async ({
    page,
  }) => {
    const expander = page.getByText(/how the agent got here/i).first();
    await expander.waitFor({ state: "visible", timeout: 10000 });

    const before = await page.locator(GROUP).count();
    await expander.click();
    // The superseded rounds are now on screen…
    await expect(page.getByText(/round \d/i).first()).toBeVisible({
      timeout: 10000,
    });
    // …and contributed no new controls. Rating a position the agent
    // already abandoned isn't signal, so the history rows stay bare.
    expect(await page.locator(GROUP).count()).toBe(before);
  });
});
