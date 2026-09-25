import { expect, test } from '@playwright/test';

test('onboarding, tasks, roadmap, files and trash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByPlaceholder('Ваше имя').fill('Тест Тестов');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByPlaceholder('Например, Команда продукта').fill('QA');
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Поехали' }).click();

  await expect(page.getByRole('heading', { name: /Тест/ })).toBeVisible();

  // Quick create with the keyboard.
  await page.keyboard.press('c');
  await page.getByPlaceholder('Что нужно сделать?').fill('Проверить релиз');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Создано: Проверить релиз')).toBeVisible();

  // Project roadmap renders the timeline with initiatives.
  // The first "Роадмап" link in the sidebar is the portfolio, the second is the expanded project tab.
  await page.getByRole('complementary').getByRole('link', { name: 'Роадмап' }).nth(1).click();
  await expect(page.getByText('Онбординг без трения').first()).toBeVisible();

  // Backlog: open an item in the side peek.
  await page.getByRole('main').getByRole('link', { name: 'Бэклог' }).click();
  const row = page.locator('[data-peek-keep]', { hasText: 'Регистрация по номеру телефона' }).first();
  await row.hover();
  await row.getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByRole('complementary').getByText('Критерии готовности')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // Files: add a Plaud link.
  await page.getByRole('main').getByRole('link', { name: 'Файлы' }).click();
  await page.getByRole('button', { name: 'Ссылка' }).click();
  await page.getByPlaceholder('Вставьте ссылку, например на запись в Plaud').fill('web.plaud.ai/share/test');
  await expect(page.getByText('Это запись Plaud', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Ссылка добавлена')).toBeVisible();

  // Delete a page and restore it from the trash.
  await page.getByRole('link', { name: 'Заметки 1:1 с Дмитрием' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Удалить страницу' }).click();
  await expect(page.getByRole('link', { name: 'Заметки 1:1 с Дмитрием' })).toHaveCount(0);
  await page.getByRole('button', { name: /Корзина/ }).click();
  await page.getByRole('button', { name: 'Восстановить' }).first().click();
  await expect(page.getByRole('link', { name: 'Заметки 1:1 с Дмитрием' })).toBeVisible();

  expect(errors).toEqual([]);
});
