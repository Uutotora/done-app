import { expect, test } from '@playwright/test';

test('404 offers working search and home on desktop, dark theme and mobile', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Посмотреть демо' }).click();
  await expect(page.getByRole('heading', { name: /Гость/ })).toBeVisible();
  await page.goto('/missing-page');
  await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
  await expect(page.locator('.state-illustration')).toHaveJSProperty('naturalWidth', 1536);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.state-panel')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: testInfo.outputPath('404-desktop.png') });
  await page.getByRole('button', { name: 'Найти в пространстве' }).click();
  await expect(page.getByRole('dialog', { name: 'Поиск', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Переключить тему', exact: true }).click();
  await expect(page.locator('.state-illustration')).toHaveCSS('filter', 'invert(1)');
  await page.screenshot({ path: testInfo.outputPath('404-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: 'На главную', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('404-mobile.png') });
  await page.getByRole('link', { name: 'На главную', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Гость/ })).toBeVisible();
});

test('invitation keeps verified identity, responsive layout and network retry', async ({ page }, testInfo) => {
  let reachable = false;
  await page.route('**/api/auth/invitation', async (route) => {
    if (!reachable) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fulfill({
      json: { email: 'teammate@example.test', workspace: 'Команда продукта', inviter: 'Александра', role: 'editor', expires: Date.now() + 86400000 },
    });
  });
  await page.goto('/?invite=preview&email=wrong@example.test');
  await expect(page.getByRole('heading', { name: 'Приглашение пока недоступно' })).toBeVisible();
  reachable = true;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Команда продукта', exact: true })).toBeVisible();
  await expect(page.getByText('teammate@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('wrong@example.test', { exact: true })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: testInfo.outputPath('invitation-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Присоединиться к команде', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('invitation-mobile.png') });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Join the team', exact: true })).toBeVisible();
});

test('reset connection failure never claims expiry and retries the same link', async ({ page }, testInfo) => {
  let reachable = false;
  await page.route('**/api/auth/reset/check', async (route) => {
    if (!reachable) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fulfill({ json: { email: 'teammate@example.test', name: 'Teammate' } });
  });
  await page.goto('/?reset=preview');
  await expect(page.getByRole('heading', { name: 'Не удалось проверить ссылку' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ссылка больше не работает' })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: testInfo.outputPath('reset-network.png') });
  reachable = true;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новый пароль', exact: true })).toBeVisible();
  await expect(page.getByLabel('Новый пароль', { exact: true })).toBeVisible();
});

test('empty archive and file search show recoverable states', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Посмотреть демо' }).click();
  await expect(page.getByRole('heading', { name: /Гость/ })).toBeVisible();
  await page.goto('/inbox?tab=archived');
  await expect(page.getByRole('heading', { name: 'Архив пуст', exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: testInfo.outputPath('inbox-archive.png') });
  await page.goto('/files');
  await page.getByRole('main').getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('main').getByPlaceholder('Поиск', { exact: true }).fill('no-such-file-ever');
  await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить поиск', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toHaveCount(0);
});

test('a failed lazy page leaves navigation available and reload recovers it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Посмотреть демо' }).click();
  await expect(page.getByRole('heading', { name: /Гость/ })).toBeVisible();
  await page.route('**/src/views/Settings.tsx*', (route) => route.abort());
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Не удалось открыть страницу' })).toBeVisible();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.unroute('**/src/views/Settings.tsx*');
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Не удалось открыть страницу' })).toHaveCount(0);
  await expect(page.getByRole('main')).toContainText('Мой аккаунт');
});
