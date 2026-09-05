import { expect, test, type Page } from '@playwright/test';

/**
 * The rota grid's two non-pointer contracts: the pinned columns, and moving a
 * shift without a mouse.
 *
 * ## Why these need a browser
 *
 * Neither is expressible as a unit test. `position: sticky` is a rendering
 * behaviour that depends on which ancestor is the scrollport — the sticky date
 * row does nothing at all unless the grid has its own bounded viewport, and
 * that fact is invisible in the component source. The keyboard move is a
 * sequence of real key events against a real focus ring.
 *
 * ## Why the preview route
 *
 * `/app-preview/rota` mounts the real `AppShell`, the real `RotaGrid` and the
 * real `ShiftChip` against fixtures, with the move committing to local state
 * instead of Supabase. Everything under test here is the shipped component.
 */

/** The banner is `fixed bottom-0` and intercepts clicks until it is answered. */
async function acceptConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'rotaflow:consent',
        JSON.stringify({
          version: 1,
          preferences: true,
          diagnostics: false,
          decidedAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* not this test's subject */
    }
  });
}

test.use({ viewport: { width: 1100, height: 800 } });

test.beforeEach(async ({ page }) => {
  await acceptConsent(page);
  await page.goto('/app-preview/rota');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Rota Builder' }),
  ).toBeVisible();
});

test.describe('pinned columns', () => {
  test('the staff name stays put while the grid scrolls sideways', async ({ page }) => {
    const region = page.getByRole('region', { name: 'Rota grid' });
    const name = page.getByText('Sarah Johnson').first();

    const before = (await name.boundingBox())!.x;
    await region.evaluate((el) => {
      el.scrollLeft = 400;
    });
    // Confirm the scroll actually happened, or the assertion below proves
    // nothing: a grid that cannot scroll trivially keeps its names in place.
    expect(await region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    const after = (await name.boundingBox())!.x;
    expect(Math.abs(after - before)).toBeLessThan(2);
  });

  test('the date row stays at the top while the grid scrolls down', async ({ page }) => {
    const region = page.getByRole('region', { name: 'Rota grid' });

    const scrollable = await region.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(scrollable, 'the grid needs its own bounded viewport').toBeGreaterThan(0);

    await region.evaluate((el) => {
      el.scrollTop = Math.min(200, el.scrollHeight - el.clientHeight);
    });

    const offset = await region.evaluate((el) => {
      const header = el.querySelector('.sticky.top-0');
      if (!header) return null;
      return header.getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    expect(offset).not.toBeNull();
    expect(Math.abs(offset!)).toBeLessThan(2);
  });

  test('the pinned column is opaque, so chips cannot show through it', async ({
    page,
  }) => {
    // A transparent sticky cell is the classic version of this bug: it pins
    // correctly and the shifts slide visibly underneath the names.
    const background = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.sticky.left-0')].find((el) =>
        el.textContent?.includes('Sarah'),
      );
      return cell ? getComputedStyle(cell).backgroundColor : null;
    });
    expect(background).not.toBeNull();
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    expect(background).not.toBe('transparent');
  });
});

test.describe('moving a shift with the keyboard', () => {
  test('M then the arrows then Enter moves it, and focus comes back', async ({
    page,
  }) => {
    const chip = page.locator('[data-shift-id]').first();
    const shiftId = await chip.getAttribute('data-shift-id');
    await chip.focus();

    await page.keyboard.press('m');
    const status = page.getByRole('status').first();
    await expect(status).toContainText(/Moving shift to/i);

    // Right is a different day, down is a different person: the move addresses
    // the grid in rows and dates, not in pixels.
    const firstTarget = await status.innerText();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(status).not.toHaveText(firstTarget);

    // The landing cell is drawn, not only announced. Matched on the wash as
    // well as the ring: a chip that is merely *selected* also carries
    // `ring-primary`, so the ring alone would pass with no move in progress.
    await expect(page.locator('.ring-primary.bg-primary-wash')).toHaveCount(1);

    await page.keyboard.press('Enter');

    // The chip is unmounted and remounted in another cell, which drops focus
    // to <body> unless something puts it back.
    await expect(page.locator(`[data-shift-id="${shiftId}"]`)).toBeFocused();
    await expect(status).toHaveText('');
  });

  test('Escape leaves the shift where it was', async ({ page }) => {
    const chip = page.locator('[data-shift-id]').first();
    const shiftId = await chip.getAttribute('data-shift-id');
    const cellBefore = await chip.evaluate(
      (el) => el.closest('[class*="min-h-"]')?.parentElement?.parentElement?.textContent,
    );

    await chip.focus();
    await page.keyboard.press('m');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('status').first()).toContainText(/Moving shift to/i);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('status').first()).toHaveText('');

    const cellAfter = await page
      .locator(`[data-shift-id="${shiftId}"]`)
      .evaluate(
        (el) =>
          el.closest('[class*="min-h-"]')?.parentElement?.parentElement?.textContent,
      );
    expect(cellAfter).toBe(cellBefore);
  });

  test('the shortcut is announced to assistive technology and written on screen', async ({
    page,
  }) => {
    const chip = page.locator('[data-shift-id]').first();
    await expect(chip).toHaveAttribute('aria-keyshortcuts', 'M');
    // dnd-kit's own `aria-roledescription` is "draggable", which is the half a
    // keyboard user cannot act on.
    await expect(chip).toHaveAttribute('aria-roledescription', /M to move it/i);
    await expect(
      page.getByText(/press.*M.*to move it with the arrow keys/i),
    ).toBeVisible();
  });
});

test.describe('rota toolbar', () => {
  test('collapses the filters behind one counted chip below xl', async ({ page }) => {
    await expect(page.getByLabel('Filter by location')).toBeHidden();
    await expect(page.getByText('Filters', { exact: true })).toBeVisible();
  });

  test('shows the filters inline once the column is wide enough', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect(page.getByLabel('Filter by location')).toBeVisible();
    await expect(page.getByText('Filters', { exact: true })).toBeHidden();
  });
});
