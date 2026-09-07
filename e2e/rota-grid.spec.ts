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

  test('the hint is on screen without scrolling, and above the first shift', async ({
    page,
  }) => {
    // `toBeVisible()` above passes on an element 260px below the fold — it
    // means "not display:none", not "a user can see it". This is the finding
    // (design review F5): the hint rendered at y=1160 on a 900px window,
    // underneath every row of the grid it describes.
    const hint = page.getByText(/press.*M.*to move it with the arrow keys/i);
    const hintBox = (await hint.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(
      hintBox.y + hintBox.height,
      'the keyboard hint has to be inside the first viewport',
    ).toBeLessThan(viewport.height);

    // Above the grid's content, not merely on screen: a hint that arrives
    // after the thing it explains has already been read is not a hint.
    const firstChip = (await page.locator('[data-shift-id]').first().boundingBox())!;
    expect(hintBox.y).toBeLessThan(firstChip.y);
  });

  test('the hint stays put when the grid scrolls sideways', async ({ page }) => {
    // The grid content is ~2,400px wide and the hint is a child of it, so
    // without `sticky left-0` it slides off the left edge the moment a manager
    // scrolls to Friday — which is most of the time they spend on this screen.
    const region = page.getByRole('region', { name: 'Rota grid' });
    const hint = page.getByText(/press.*M.*to move it with the arrow keys/i);

    const before = (await hint.boundingBox())!.x;
    await region.evaluate((el) => {
      el.scrollLeft = 400;
    });
    expect(await region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    const after = (await hint.boundingBox())!.x;
    expect(Math.abs(after - before)).toBeLessThan(2);
  });
});

test.describe('the pinned staff column at phone width', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('a staff name is rendered whole, never cut to an ellipsis', async ({ page }) => {
    // Design review F6. At 375px the pinned column leaves 73px of text and
    // `truncate` cut "Sarah Johnson" to "Sarah Jo…" — so two people sharing a
    // forename read identically on the one column whose job is saying whose
    // row this is.
    //
    // Measured, not asserted on a class. But NOT with `scrollWidth >
    // clientWidth`: that is only what an ellipsis is when the element has
    // `overflow: hidden`, and the fix removed the hidden overflow along with
    // the `truncate`. Run against the real app on 7 September 2026 that check
    // reported every name "clipped" while the box was `overflow: visible`,
    // and it would equally have reported the pre-fix ellipsis as fine on a
    // wide screen. What is actually true after the fix is that the name box
    // has a usable width and the text wraps within it, so that is what is
    // asserted: a non-zero width, and a height of at most two lines.
    await page.evaluate(() => document.fonts.ready);

    // The first paragraph of the name block is the name; the second, when
    // there is one, is the job title, which keeps its ellipsis on purpose.
    const names = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.sticky.left-0 .min-w-0 > p:first-child'),
      ).map((el) => ({
        text: el.textContent ?? '',
        width: el.clientWidth,
        height: el.clientHeight,
        // The failure this replaced: a zero-width box wraps at every
        // character, so a two-word name became a tower of single letters
        // hundreds of pixels tall. One line is 20px at `text-sm`.
        lines: Math.round(el.clientHeight / 20),
      })),
    );

    expect(names.length, 'the fixture has to render some staff names').toBeGreaterThan(2);
    // A floor on the pinned track (`rotaGridTemplate`), not a wish.
    expect(names.every((n) => n.width > 60)).toBe(true);
    expect(names.filter((n) => n.lines > 2)).toEqual([]);
    // The full text is present, not a truncated string that happens to fit.
    expect(names.map((n) => n.text)).toContain('Sarah Johnson');
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

/**
 * Design review F6, second half: "roughly 430px of the 812px viewport is
 * chrome before the first row of data".
 *
 * Measured on this route before the fix: the grid's scroll region began at
 * y=596 of an 812px screen and the first staff row at y=676, so 83% of a phone
 * was spent before any rota appeared. The thresholds below are fractions of
 * the viewport rather than pixel constants — a constant would either rot or
 * have to be updated by whoever next touches the toolbar, and the finding was
 * never about a specific number.
 */
test.describe('the rota toolbar on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the grid starts inside the top two-thirds of the screen', async ({ page }) => {
    await page.evaluate(() => document.fonts.ready);
    const viewport = page.viewportSize()!;

    const region = (await page.getByRole('region', { name: 'Rota grid' }).boundingBox())!;
    expect(region.y, 'chrome above the grid').toBeLessThan(viewport.height * 0.65);

    const firstRow = (await page.getByText('Sarah Johnson').first().boundingBox())!;
    expect(firstRow.y, 'the first row of data').toBeLessThan(viewport.height * 0.75);
  });

  test('the primary action stays outside every disclosure', async ({ page }) => {
    // Secondary controls are what collapses. A manager must not have to open
    // anything to find out whether the week is published.
    const publish = page.getByRole('button', { name: /^Publish/ }).first();
    await expect(publish).toBeVisible();
    expect(
      await publish.evaluate((el) => el.closest('details') !== null),
      'Publish must not be inside a disclosure',
    ).toBe(false);
  });

  test('the search is still reachable, one tap inside Filters', async ({ page }) => {
    // Collapsed, not deleted. It filters the same grid the three selects do,
    // so it lives with them rather than on its own 60px line above the fold.
    const search = page.getByPlaceholder('Search staff, skills, shifts…');
    const inFilters = search.filter({ has: page.locator('xpath=ancestor::details') });
    expect(await inFilters.count()).toBeGreaterThan(0);
    await expect(inFilters.first()).toBeHidden();

    await page.getByText('Filters', { exact: true }).click();
    await expect(inFilters.first()).toBeVisible();
  });
});

/**
 * The other half of the same change: everything above collapses below `sm`
 * and nothing at `sm` or wider may move. 640px is the boundary itself, which
 * is where an off-by-one in a media query shows up.
 */
for (const width of [640, 1440]) {
  test.describe(`the rota toolbar at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('the search sits in the page header, not behind a disclosure', async ({
      page,
    }) => {
      const search = page.getByPlaceholder('Search staff, skills, shifts…');
      const visible = search.locator('visible=true');
      await expect(visible).toHaveCount(1);
      expect(
        await visible.evaluate((el) => el.closest('details') !== null),
        'the search must be on the page, not inside a disclosure',
      ).toBe(false);
    });

    test('the week controls are on the toolbar, not behind a disclosure', async ({
      page,
    }) => {
      const view = page.getByRole('group', { name: 'View' });
      await expect(view).toBeVisible();
      expect(
        await view.evaluate((el) => el.closest('details') !== null),
        'the week controls must be on the toolbar',
      ).toBe(false);
    });
  });
}
