import { expect, test } from '@playwright/test';

test('welcome fits a laptop and a phone, respects reduced motion, and keeps one entry point', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Добро пожаловать в Done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Посмотреть демо' })).toBeInViewport();
  await expect(page.locator('.auth-artwork')).toHaveCSS('width', '240px');
  await expect(page.getByRole('img', { name: 'Done', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /анимацию|Вода|Солнце|Звёзды/ })).toHaveCount(0);
  await expect(page.locator('.auth-material-water')).toBeVisible();
  await expect(page.locator('.auth-flipbook')).toHaveCSS('animation-duration', '2s');
  // Observe the actual playback, ensuring all 24 sprite cells are displayed.
  const displayedFrames = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const element = document.querySelector('.auth-flipbook')!;
        const positions = new Set<string>();
        const start = performance.now();
        function sample() {
          positions.add(getComputedStyle(element).backgroundPosition);
          if (positions.size === 24 || performance.now() - start > 4500) resolve(positions.size);
          else requestAnimationFrame(sample);
        }
        sample();
      }),
  );
  expect(displayedFrames).toBe(24);
  await page.screenshot({ path: testInfo.outputPath('welcome-laptop.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Done' })).toBeVisible();
  await page.getByRole('button', { name: 'RU', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.auth-flipbook')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.auth-material')).toHaveCSS('animation-name', 'none');
  await expect(page.getByRole('button', { name: 'Включить анимацию' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Продолжить с почтой' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('welcome-mobile.png'), animations: 'disabled' });
  await page.goto('/?invite=expired-test-link&email=wrong@example.test');
  await expect(page.getByRole('heading', { name: 'Эта ссылка уже не действует' })).toBeVisible();
  await expect(page.getByLabel('Придумайте пароль')).toHaveCount(0);
  await expect(page.locator('.auth-stationery-notebook')).toBeVisible();
  await expect(page.locator('.auth-stationery-notebook')).toHaveCSS('animation-name', 'none');
  const decorationBounds = await page.locator('.auth-stationery').boundingBox();
  const formBounds = await page.locator('.auth-card').boundingBox();
  expect(decorationBounds!.y + decorationBounds!.height).toBeLessThanOrEqual(formBounds!.y);
  await page.screenshot({ path: testInfo.outputPath('expired-invitation-mobile.png'), animations: 'disabled' });
  await page.goto('/?reset=expired-test-link');
  await expect(page.getByRole('heading', { name: 'Ссылка больше не работает' })).toBeVisible();
  await page.getByRole('button', { name: 'Запросить новую ссылку' }).click();
  await expect(page.getByRole('heading', { name: 'Забыли пароль?' })).toBeVisible();
  await expect(page.locator('.auth-card')).toHaveCSS('animation-name', 'none');
});
