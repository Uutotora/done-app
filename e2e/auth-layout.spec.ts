import { expect, test } from '@playwright/test';

test('welcome fits a laptop and a phone, respects reduced motion, and keeps one entry point', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Большие идеи. Понятные планы.' })).toBeVisible();
  await expect(page.locator('.auth-reveal-line')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Посмотреть демо' })).toBeInViewport();
  await expect(page.locator('.auth-artwork')).toHaveCSS('width', '240px');
  const objects = page.locator('.auth-welcome-object');
  const notebook = page.locator('.auth-welcome-notebook .auth-welcome-frame');
  const pencil = page.locator('.auth-welcome-pencil .auth-welcome-frame');
  await expect(objects).toHaveCount(2);
  await expect(notebook).toHaveCSS('background-image', /welcome-notebook-24\.png/);
  await expect(pencil).toHaveCSS('background-image', /welcome-pencil-24\.png/);
  await expect(notebook).toHaveCSS('animation-duration', '2.4s');
  await expect(pencil).toHaveCSS('animation-duration', '2.8s');
  for (const frame of [notebook, pencil]) {
    await expect(frame).toHaveAttribute('data-frame-count', '24');
    await expect(frame).toHaveCSS('background-size', '600% 400%');
  }
  async function expectUnobstructedWelcome() {
    const content = await Promise.all(
      ['.auth-artwork', '.auth-hero-title', '.auth-email-form'].map((selector) => page.locator(selector).boundingBox()),
    );
    for (const object of await objects.all()) {
      await expect(object).toBeInViewport();
      const bounds = (await object.boundingBox())!;
      for (const area of content) {
        const overlaps =
          bounds.x < area!.x + area!.width &&
          bounds.x + bounds.width > area!.x &&
          bounds.y < area!.y + area!.height &&
          bounds.y + bounds.height > area!.y;
        expect(overlaps, 'Decorative drawings must not cover the artwork, heading, or email form').toBe(false);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expectUnobstructedWelcome();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const frame of [notebook, pencil]) {
    await expect(frame).toHaveCSS('animation-name', 'none');
    await expect(frame).toHaveCSS('background-position', '0% 0%');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const frame of [notebook, pencil]) await expect(frame).toHaveCSS('animation-name', 'auth-flipbook');
  await expect(page.getByRole('img', { name: 'Done', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /анимацию|Вода|Солнце|Звёзды/ })).toHaveCount(0);
  await expect(page.locator('.auth-material-water').first()).toBeVisible();
  await expect(page.locator('.auth-flipbook')).toHaveCSS('animation-duration', '2s');
  // Observe real playback for all three sheets, not just their declared frame counts.
  const displayedFrames = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const elements = [
          document.querySelector('.auth-flipbook')!,
          document.querySelector('.auth-welcome-notebook .auth-welcome-frame')!,
          document.querySelector('.auth-welcome-pencil .auth-welcome-frame')!,
        ];
        const positions = elements.map(() => new Set<string>());
        const start = performance.now();
        function sample() {
          elements.forEach((element, index) => positions[index].add(getComputedStyle(element).backgroundPosition));
          const counts = positions.map((frames) => frames.size);
          if (counts.every((count) => count === 24) || performance.now() - start > 4500) resolve(counts);
          else requestAnimationFrame(sample);
        }
        sample();
      }),
  );
  expect(displayedFrames).toEqual([24, 24, 24]);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 981, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expectUnobstructedWelcome();
  }
  await page.setViewportSize({ width: 980, height: 720 });
  for (const object of await objects.all()) await expect(object).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: testInfo.outputPath('welcome-laptop.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Big ideas. Clear plans.' })).toBeVisible();
  await page.getByRole('button', { name: 'RU', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const object of await objects.all()) await expect(object).toBeHidden();
  await expect(page.locator('.auth-flipbook')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.auth-material').first()).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.auth-material').first()).toHaveCSS('transform', 'none');
  // Reduced motion must reveal every letter immediately, including a mid-reveal language switch.
  const visibleLetters = await page.locator('.auth-reveal-line [aria-hidden="true"] > span > span').evaluateAll((letters) =>
    letters.every((letter) => {
      const text = letter.getBoundingClientRect();
      const mask = letter.parentElement!.getBoundingClientRect();
      return text.top >= mask.top - 1 && text.bottom <= mask.bottom + 1;
    }),
  );
  expect(visibleLetters).toBe(true);
  await expect(page.getByRole('button', { name: 'Включить анимацию' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeInViewport();
  // Sign-in screens are always light, even when the system is dark, and have no theme switch.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: /тема/i })).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('welcome-mobile.png'), animations: 'disabled' });
  await page.goto('/?invite=expired-test-link&email=wrong@example.test');
  await expect(page.getByRole('heading', { name: 'Ссылка больше не работает' })).toBeVisible();
  await expect(page.getByLabel('Придумайте пароль')).toHaveCount(0);
  await expect(page.locator('.auth-state-art .state-illustration')).toBeVisible();
  const decorationBounds = await page.locator('.auth-state-art').boundingBox();
  const formBounds = await page.locator('.auth-card').boundingBox();
  expect(decorationBounds!.y + decorationBounds!.height).toBeLessThanOrEqual(formBounds!.y);
  await page.screenshot({ path: testInfo.outputPath('expired-invitation-mobile.png'), animations: 'disabled' });
  await page.goto('/?reset=expired-test-link');
  await expect(page.getByRole('heading', { name: 'Ссылка больше не работает' })).toBeVisible();
  await page.getByRole('button', { name: 'Запросить новую ссылку' }).click();
  await expect(page.getByRole('heading', { name: 'Забыли пароль?' })).toBeVisible();
  await expect(page.locator('.auth-card')).toHaveCSS('animation-name', 'none');
});
