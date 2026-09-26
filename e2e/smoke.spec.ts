import { expect, test } from '@playwright/test';

test('onboarding, tasks, roadmap, files and trash', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Попробовать демо' }).click();
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
  await page.getByRole('button', { name: 'Добавить зависимость' }).click();
  await page.getByPlaceholder('Найти задачу…').fill('Проверить релиз');
  await page.getByRole('button', { name: /Проверить релиз/ }).click();
  await expect(page.getByText('Ожидает завершения · 1')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('main').getByRole('link', { name: 'Доска', exact: true }).click();
  await expect(page.getByText('Регистрация по номеру телефона').first()).toBeVisible();
  // Sprints: the demo has one running sprint with a burndown and one being planned.
  await page.getByRole('main').getByRole('link', { name: 'Спринты', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Спринт', exact: true })).toHaveValue(/Спринт 15/);
  await expect(page.getByRole('img', { name: 'Burndown' })).toBeVisible();
  await page.getByRole('button', { name: 'Планирование', exact: true }).click();
  await expect(page.getByText('Бэклог проекта')).toBeVisible();
  await page.getByRole('button', { name: 'Текущий спринт', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить спринт', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Завершить спринт', exact: true }).click();
  await expect(page.getByText('Спринт завершен')).toBeVisible();
  await expect(page.getByRole('button', { name: /Начать спринт/ })).toBeVisible();

  await page.getByRole('main').getByRole('link', { name: 'Календарь', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Сегодня');
  await page.getByRole('main').getByRole('link', { name: 'Карта', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Документы', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('PRD');

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

  await page.keyboard.press('Escape');

  // Inbox: mentions from teammates in the demo, archived with the keyboard.
  await page
    .getByRole('complementary')
    .getByRole('link', { name: /Входящие/ })
    .click();
  await expect(page.getByText('Вас упомянули')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.getByText('Вас упомянули')).toHaveCount(0);

  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои задачи', exact: true })).toBeVisible();
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({ path: testInfo.outputPath('my-work.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath('my-work-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('complementary', { name: 'Проекты', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Развернуть сайдбар', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Проекты', exact: true })).toBeVisible();
  await page.getByRole('complementary', { name: 'Проекты', exact: true }).getByRole('link', { name: 'Главная', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Тест/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Проекты', exact: true })).toBeHidden();
  await expect(page.locator('.workspace-sidebar')).toHaveCSS('width', '0px');
  await expect(page.getByRole('heading', { name: /Тест/ }).locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('mobile-home.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
