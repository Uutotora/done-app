import { expect, test } from '@playwright/test';

// The second test signs in as the owner created by the first one.
test.describe.configure({ mode: 'serial' });

test('welcome, registration draft, durable account, project and viewer access', async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Большие идеи. Понятные планы.' })).toBeVisible();
  await expect(page.locator('.auth-flipbook')).toBeVisible();
  await expect(page.locator('.auth-material').first()).toHaveClass(/auth-material-water/);
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), animations: 'disabled' });
  await page.getByLabel('Рабочая почта').fill('owner@example.test');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Создайте аккаунт' })).toBeVisible();
  await page.getByLabel('Имя', { exact: true }).fill('Мария');
  // Nobody has to invent a workspace: only a name and a password.
  await expect(page.getByLabel(/Название/)).toHaveCount(0);
  await expect(page.locator('.auth-flipbook')).toHaveCount(0);
  const formBounds = await page.locator('.auth-card').boundingBox();
  const notebookBounds = await page.locator('.auth-stationery-notebook').boundingBox();
  const planeBounds = await page.locator('.auth-stationery-plane').boundingBox();
  expect(notebookBounds!.x + notebookBounds!.width).toBeLessThan(formBounds!.x);
  expect(planeBounds!.x).toBeGreaterThan(formBounds!.x + formBounds!.width);

  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Рабочая почта')).toHaveValue('owner@example.test');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Мария');
  await page.getByLabel('Придумайте пароль', { exact: true }).fill('Disposable-QA-Password-2026');
  await page.screenshot({ path: testInfo.outputPath('registration.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Мария/ })).toBeVisible();
  // The bottom of the sidebar is the person, not a workspace.
  await expect(page.getByRole('button', { name: 'Профиль и настройки' })).toContainText('Мария');
  // A chosen animal is saved to the account, survives reload, and remains selected.
  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  const avatars = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(avatars.getByRole('radio')).toHaveCount(24);
  await avatars.getByRole('radio', { name: 'Капибара', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('avatar-picker.png'), animations: 'disabled' });
  const savedAvatar = page.waitForResponse((r) => r.url().endsWith('/api/workspace') && r.request().method() === 'PATCH' && r.status() === 200);
  await avatars.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await savedAvatar;
  await page.reload();
  await page.getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  await expect(avatars.getByRole('radio', { name: 'Капибара', exact: true })).toBeChecked();
  await avatars.getByRole('button', { name: 'Случайный', exact: true }).click();
  await expect(avatars.getByRole('radio', { name: 'Капибара', exact: true })).not.toBeChecked();
  await avatars.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  await expect(avatars.getByRole('radio', { name: 'Капибара', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.goto('/');
  // Setup must switch to login immediately, even without reloading the page.
  await page.getByRole('button', { name: 'Профиль и настройки' }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
  await expect(page.getByRole('heading', { name: 'Вы вышли из Done' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вы вышли из Done' })).toBeVisible();
  await expect(page.getByText('owner@example.test', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Войти снова' }).click();
  await page.getByLabel('Рабочая почта').fill('owner@example.test');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Пароль', { exact: true }).fill('Disposable-QA-Password-2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
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

  // Losing the network shows the calm offline banner instead of an error, and edits still save on their own once it returns.
  await page.context().setOffline(true);
  await page.keyboard.press('c');
  await page.getByPlaceholder('Что нужно сделать?').fill('Офлайн-задача');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Нет подключения', { exact: false }).first()).toBeVisible({ timeout: 15000 });
  await page.context().setOffline(false);
  await expect(page.getByText('Нет подключения', { exact: false })).toHaveCount(0, { timeout: 15000 });

  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click();
  await page.getByRole('button', { name: 'Вся команда', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Проверить сохранение', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Профиль и настройки' }).click();
  await page.getByRole('menuitem', { name: 'Люди и доступ' }).click();
  await expect(page.getByRole('heading', { name: 'Люди', exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Пригласить', exact: true }).click();
  const inviteDialog = page.getByRole('dialog', { name: 'Пригласить в команду' });
  await inviteDialog.getByLabel('Почта', { exact: true }).fill('viewer@example.test');
  await inviteDialog.getByLabel('Почта', { exact: true }).press('Enter');
  await inviteDialog.getByRole('button', { name: 'Роль', exact: true }).click();
  await page.getByRole('option', { name: /Наблюдатель/ }).click();
  await inviteDialog.getByRole('button', { name: 'Пригласить', exact: true }).click();
  const invitation = await page.getByLabel('Ссылка приглашения для viewer@example.test').inputValue();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('tab', { name: /Приглашения/ }).click();
  await expect(page.getByText('viewer@example.test')).toBeVisible();
  await expect(page.locator('.anim-overlay')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({ path: testInfo.outputPath('admin.png'), animations: 'disabled' });

  const ownerInviteTab = await page.context().newPage();
  await ownerInviteTab.goto(invitation);
  await expect(ownerInviteTab.getByRole('heading', { name: 'Присоединяйтесь к «Example»' })).toBeVisible();
  await expect(ownerInviteTab.getByText(/Сейчас открыт аккаунт owner@example.test/)).toBeVisible();
  await ownerInviteTab.close();

  const viewerContext = await browser.newContext({ locale: 'ru-RU' });
  const viewer = await viewerContext.newPage();
  // The server's invitation email wins over a tampered URL query.
  const invitationUrl = new URL(invitation);
  invitationUrl.searchParams.set('email', 'wrong@example.test');
  await viewer.goto(invitationUrl.toString());
  await expect(viewer.getByRole('heading', { name: 'Присоединяйтесь к «Example»' })).toBeVisible();
  await expect(viewer.getByText('Мария приглашает вас как наблюдателя')).toBeVisible();
  await expect(viewer.getByText('viewer@example.test', { exact: true })).toBeVisible();
  await viewer.screenshot({ path: testInfo.outputPath('invitation.png'), animations: 'disabled' });
  await viewer.getByLabel('Имя', { exact: true }).fill('Наблюдатель QA');
  await viewer.reload();
  await expect(viewer.getByLabel('Имя', { exact: true })).toHaveValue('Наблюдатель QA');
  await expect(viewer.getByLabel('Придумайте пароль', { exact: true })).toHaveValue('');
  await viewer.getByLabel('Придумайте пароль', { exact: true }).fill('Disposable-QA-Viewer-2026');
  await viewer.getByRole('button', { name: 'Присоединиться', exact: true }).click();
  await viewer.getByRole('complementary').getByRole('link', { name: 'Запуск продукта' }).click();
  await expect(viewer.getByText('Вы можете только просматривать этот проект.')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Новый', exact: true })).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Профиль и настройки' }).click();
  await expect(viewer.getByRole('menuitem', { name: 'Выйти' })).toBeVisible();
  await expect(viewer.getByRole('menuitem', { name: 'Люди и доступ' })).toHaveCount(0);
  await viewer.keyboard.press('Escape');
  await viewer.goto('/admin');
  await expect(viewer.getByText('Составом и доступом управляют администраторы.')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Пригласить', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Пригласить в команду' })).toHaveCount(0);
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
  // Even a signed-in visitor sees a consumed invitation's clear recovery screen.
  await viewer.goto(invitation);
  await expect(viewer.getByRole('heading', { name: 'Ссылка больше не работает' })).toBeVisible();
  // …and goes straight back to the app, still signed in.
  await viewer.getByRole('button', { name: 'Открыть Done' }).click();
  await expect(viewer.getByRole('button', { name: 'Профиль и настройки' })).toContainText('Наблюдатель QA');
  await viewerContext.close();

  await page.getByRole('button', { name: 'Профиль и настройки' }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
  await expect(page.getByRole('heading', { name: 'Вы вышли из Done' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вы вышли из Done' })).toBeVisible();
  await expect(page.getByText('owner@example.test', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Войти снова' }).click();
  await page.getByLabel('Рабочая почта').fill('owner@example.test');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
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

  // Live editing: the owner types in the project brief and the teammate's open editor shows it without a reload.
  const ownerBrief = owner.locator('.done-editor [contenteditable="true"]').first();
  await ownerBrief.click();
  await owner.keyboard.type('Живая правка брифа');
  await expect(member.locator('.done-editor').first()).toContainText('Живая правка брифа', { timeout: 10_000 });
  expect(errors).toEqual([]);
  await memberContext.close();
  await ownerContext.close();
});

test('an admin shares the invite link and a teammate joins with it', async ({ browser }, testInfo) => {
  const headers = { 'x-done-client': 'web' };
  const ownerContext = await browser.newContext({ locale: 'ru-RU' });
  const owner = await ownerContext.newPage();
  expect(
    (
      await owner.request.post('/api/auth/login', { headers, data: { email: 'owner@example.test', password: 'Disposable-QA-Password-2026' } })
    ).status(),
  ).toBe(200);
  const errors: string[] = [];
  owner.on('pageerror', (e) => errors.push(e.message));
  await owner.goto('/');
  // Invite from the sidebar, next to the profile.
  await owner.getByRole('button', { name: 'Пригласить в команду' }).click();
  const dialog = owner.getByRole('dialog', { name: 'Пригласить в команду' });
  await dialog.getByRole('switch', { name: 'Ссылка-приглашение' }).click();
  const field = dialog.getByRole('textbox', { name: 'Ссылка-приглашение' });
  await expect(field).toHaveValue(/\?join=/);
  const link = await field.inputValue();
  await owner.emulateMedia({ reducedMotion: 'reduce' });
  await owner.screenshot({ path: testInfo.outputPath('invite-dialog.png'), animations: 'disabled' });
  await owner.keyboard.press('Escape');

  const guestContext = await browser.newContext({ locale: 'ru-RU' });
  const guest = await guestContext.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(link);
  await expect(guest.getByRole('heading', { name: 'Присоединяйтесь к «Example»' })).toBeVisible();
  await expect(guest.getByText('Мария приглашает вас как редактора')).toBeVisible();
  await guest.emulateMedia({ reducedMotion: 'reduce' });
  await guest.screenshot({ path: testInfo.outputPath('join-link.png'), animations: 'disabled' });
  // An address that already has an account is sent to sign in instead.
  await guest.getByLabel('Рабочая почта').fill('owner@example.test');
  await guest.getByLabel('Имя', { exact: true }).fill('Лев');
  await guest.getByLabel('Придумайте пароль', { exact: true }).fill('Disposable-QA-Link-2026');
  await guest.getByRole('button', { name: 'Присоединиться', exact: true }).click();
  await expect(guest.getByText('У этой почты уже есть аккаунт.')).toBeVisible();
  await guest.getByLabel('Рабочая почта').fill('link@example.test');
  await guest.getByLabel('Придумайте пароль', { exact: true }).fill('Disposable-QA-Link-2026');
  await guest.getByRole('button', { name: 'Присоединиться', exact: true }).click();
  await expect(guest.getByRole('heading', { name: /Лев/ })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Профиль и настройки' })).toContainText('Лев');

  // Resetting the link turns the old one off.
  await owner.getByRole('button', { name: 'Пригласить в команду' }).click();
  await expect(dialog.getByText('По ссылке присоединились: 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Сбросить ссылку' }).click();
  await dialog.getByRole('button', { name: /Сбросить\?/ }).click();
  await expect(field).not.toHaveValue(link);
  const stranger = await (await browser.newContext({ locale: 'ru-RU' })).newPage();
  await stranger.goto(link);
  await expect(stranger.getByRole('heading', { name: 'Ссылка больше не работает' })).toBeVisible();
  expect(errors).toEqual([]);
  await guestContext.close();
  await ownerContext.close();
});

test('a project invite link brings a new teammate straight into that project', async ({ browser }, testInfo) => {
  const headers = { 'x-done-client': 'web' };
  const ownerContext = await browser.newContext({ locale: 'ru-RU' });
  const owner = await ownerContext.newPage();
  const errors: string[] = [];
  owner.on('pageerror', (e) => errors.push(e.message));
  expect(
    (
      await owner.request.post('/api/auth/login', { headers, data: { email: 'owner@example.test', password: 'Disposable-QA-Password-2026' } })
    ).status(),
  ).toBe(200);
  await owner.goto('/');
  await owner.getByRole('complementary').getByRole('link', { name: 'Запуск продукта' }).first().click();
  await owner.getByRole('button', { name: 'Поделиться', exact: true }).click();
  const share = owner.getByRole('dialog');
  await share.getByRole('button', { name: 'Копировать ссылку', exact: true }).click();
  const field = share.getByRole('textbox', { name: 'Пригласить по ссылке' });
  await expect(field).toHaveValue(/\?join=/);
  const link = await field.inputValue();
  await owner.emulateMedia({ reducedMotion: 'reduce' });
  await owner.screenshot({ path: testInfo.outputPath('project-share.png'), animations: 'disabled' });

  const guestContext = await browser.newContext({ locale: 'ru-RU' });
  const guest = await guestContext.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(link);
  await expect(guest.getByRole('heading', { name: 'Присоединяйтесь к проекту «Запуск продукта»' })).toBeVisible();
  await expect(guest.getByText('Мария приглашает вас редактировать проект')).toBeVisible();
  await guest.emulateMedia({ reducedMotion: 'reduce' });
  await guest.screenshot({ path: testInfo.outputPath('join-project.png'), animations: 'disabled' });
  await guest.getByLabel('Рабочая почта').fill('project@example.test');
  await guest.getByLabel('Имя', { exact: true }).fill('Ника');
  await guest.getByLabel('Придумайте пароль', { exact: true }).fill('Disposable-QA-Project-2026');
  await guest.getByRole('button', { name: 'Присоединиться', exact: true }).click();
  // Straight into the project, not the home page.
  await expect(guest).toHaveURL(/\/p\/[^/]+\/overview$/);
  await expect(guest.getByPlaceholder('Новый проект', { exact: true })).toHaveValue('Запуск продукта');
  expect(errors).toEqual([]);
  await guestContext.close();
  await ownerContext.close();
});
