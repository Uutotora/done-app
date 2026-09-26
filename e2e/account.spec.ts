import { expect, test } from '@playwright/test';

// The second test signs in as the owner created by the first one.
test.describe.configure({ mode: 'serial' });

test('welcome, registration draft, durable account, project and viewer access', async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Добро пожаловать в Done' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Done', exact: true })).toHaveCount(1);
  await expect(page.getByRole('img', { name: 'Done', exact: true })).toHaveCSS('opacity', '1');
  await expect(page.getByRole('heading', { name: 'Добро пожаловать в Done' }).locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Мария');
  await page.getByLabel('Название пространства').fill('Команда QA');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Мария');
  await expect(page.getByLabel('Название пространства')).toHaveValue('Команда QA');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('owner@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('Disposable-QA-Password-2026');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Мария/ })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Новый проект', exact: true }).click();
  await page.getByPlaceholder('Новый проект', { exact: true }).fill('Запуск продукта');
  const savedProject = page.waitForResponse((r) => r.url().endsWith('/api/workspace') && r.request().method() === 'PATCH' && r.status() === 200);
  await page.getByPlaceholder('Новый проект', { exact: true }).press('Tab');
  await savedProject;
  await page.reload();
  await expect(page.getByPlaceholder('Новый проект', { exact: true })).toHaveValue('Запуск продукта');
  await page.keyboard.press('c');
  await page.getByPlaceholder('Что нужно сделать?').fill('Проверить сохранение');
  const savedTask = page.waitForResponse((r) => r.url().endsWith('/api/workspace') && r.request().method() === 'PATCH' && r.status() === 200);
  await page.getByPlaceholder('Что нужно сделать?').press('Enter');
  await savedTask;
  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click();
  await page.getByRole('button', { name: 'Вся команда', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Проверить сохранение', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Меню пространства' }).click();
  await page.getByRole('menuitem', { name: 'Люди и доступ' }).click();
  await expect(page.getByRole('heading', { name: 'Люди', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить участников', exact: true }).click();
  await page.getByLabel('Почта', { exact: true }).fill('viewer@example.test');
  await page.getByLabel('Почта', { exact: true }).press('Enter');
  await page.getByRole('radio', { name: /Наблюдатель/ }).click();
  await page.getByRole('button', { name: 'Пригласить', exact: true }).click();
  const invitation = await page.getByLabel('Ссылка приглашения для viewer@example.test').inputValue();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('tab', { name: /Приглашения/ }).click();
  await expect(page.getByText('viewer@example.test')).toBeVisible();
  await expect(page.locator('.anim-overlay')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({ path: testInfo.outputPath('admin.png'), animations: 'disabled' });

  const viewerContext = await browser.newContext({ locale: 'ru-RU' });
  const viewer = await viewerContext.newPage();
  await viewer.goto(invitation);
  await viewer.getByLabel('Имя', { exact: true }).fill('Наблюдатель QA');
  await viewer.getByLabel('Пароль', { exact: true }).fill('Disposable-QA-Viewer-2026');
  await viewer.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await viewer.getByRole('complementary').getByRole('link', { name: 'Запуск продукта' }).click();
  await expect(viewer.getByText('Вы можете только просматривать этот проект.')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Новый', exact: true })).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Меню пространства' }).click();
  await expect(viewer.getByRole('menuitem', { name: 'Выйти' })).toBeVisible();
  await expect(viewer.getByRole('menuitem', { name: 'Люди и доступ' })).toHaveCount(0);
  await viewer.keyboard.press('Escape');
  await viewer.goto('/admin');
  await expect(viewer.getByText('Составом и доступом управляют администраторы.')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Добавить участников' })).toHaveCount(0);
  await expect(viewer.getByRole('row', { name: /Наблюдатель QA/ })).toContainText('Наблюдатель');

  // The owner sees the new member and their level in the project.
  await page.getByRole('tab', { name: /Участники/ }).click();
  await expect(page.getByRole('row', { name: /Наблюдатель QA/ })).toContainText('Наблюдатель', { timeout: 10_000 });
  await page.getByRole('complementary').getByRole('link', { name: 'Запуск продукта' }).last().click();
  await page.getByRole('button', { name: 'Поделиться', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Наблюдатель QA');
  await expect(page.getByRole('dialog')).toContainText('Может просматривать');
  await page.keyboard.press('Escape');
  const denied = await viewer.request.put('/api/workspace', { headers: { 'x-done-client': 'web' }, data: { revision: 0, data: {} } });
  expect(denied.status()).toBe(403);
  await viewerContext.close();

  await page.getByRole('button', { name: 'Меню пространства' }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
  await page.getByRole('button', { name: 'Уже есть аккаунт? Войти', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('Disposable-QA-Password-2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click();
  await page.getByRole('button', { name: 'Вся команда', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Проверить сохранение', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('teammates see mentions live in their inbox and each other on the page', async ({ browser }) => {
  const headers = { 'x-done-client': 'web' };
  const ownerContext = await browser.newContext({ locale: 'ru-RU' });
  const owner = await ownerContext.newPage();
  expect(
    (
      await owner.request.post('/api/auth/login', { headers, data: { email: 'owner@example.test', password: 'Disposable-QA-Password-2026' } })
    ).status(),
  ).toBe(200);
  const invite = await (
    await owner.request.post('/api/admin/invites', { headers, data: { email: 'member@example.test', role: 'member', projectIds: null } })
  ).json();
  const memberContext = await browser.newContext({ locale: 'ru-RU' });
  const member = await memberContext.newPage();
  const errors: string[] = [];
  member.on('pageerror', (e) => errors.push(e.message));
  owner.on('pageerror', (e) => errors.push(e.message));
  expect(
    (
      await member.request.post('/api/auth/register', {
        headers,
        data: { name: 'Мира', email: 'member@example.test', password: 'Disposable-QA-Member-2026', invite: invite.token },
      })
    ).status(),
  ).toBe(200);

  await member.goto('/');
  await owner.goto('/my-work?scope=team');
  await owner.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  const composer = owner.getByPlaceholder('Добавить комментарий...');
  await composer.click();
  await composer.pressSequentially('@Ми');
  await owner.getByRole('option', { name: /Мира/ }).click();
  await composer.pressSequentially('проверь, пожалуйста');
  const saved = owner.waitForResponse((r) => r.url().endsWith('/api/workspace') && r.request().method() === 'PATCH' && r.status() === 200);
  await composer.press('Enter');
  await saved;
  await expect(owner.getByText('@Мира').first()).toBeVisible();

  // No reload: the change arrives over the live event stream.
  const inbox = member.getByRole('complementary').getByRole('link', { name: /Входящие/ });
  await expect(inbox).toContainText('1', { timeout: 10_000 });
  await inbox.click();
  await expect(member.getByText('Вас упомянули')).toBeVisible();
  await expect(member.getByRole('main').getByText('Проверить сохранение')).toBeVisible();

  // Presence: both open the same project and see each other in the top bar.
  const projectId = await owner.evaluate(
    () => Object.keys((window as unknown as { __done: { getState: () => { projects: object } } }).__done.getState().projects)[0],
  );
  await member.goto(`/p/${projectId}/overview`);
  await owner.goto(`/p/${projectId}/overview`);
  await expect(owner.locator('header').getByTitle('Мира')).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
  await memberContext.close();
  await ownerContext.close();
});
