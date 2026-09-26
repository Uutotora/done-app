import { createEmptyData } from './store';
import { B } from './blocks';
import { generateProjectMap } from './mapgen';
import { shiftISO, todayISO } from './dates';
import { nowIso, uid } from './utils';
import type { AppNotification, DataState, Doc, Sprint, FileNode, ID, Item, Lang, Person, PlaneIssueLite, PlaneSnapshot, PlaneStateLite, Project } from './types';

export interface OnboardingInput {
  lang: Lang;
  name: string;
  role: string;
  workspaceName: string;
}

export function createBlankData(input: OnboardingInput): DataState {
  const data = createEmptyData(input.lang, input.name);
  const L = (ru: string, en: string) => (input.lang === 'ru' ? ru : en);
  data.onboarded = true;
  data.workspace = { name: input.workspaceName || data.workspace.name, icon: '🚀' };
  data.people[data.meId].role = input.role;
  const ts = nowIso();
  const pid = uid('pr');
  data.projects[pid] = {
    id: pid,
    name: L('Мой первый проект', 'My first project'),
    icon: '🌱',
    color: 'green',
    status: 'on_track',
    leadId: data.meId,
    summary: '',
    order: 1,
    createdAt: ts,
    updatedAt: ts,
  };
  data.prefs.expanded[`project:${pid}`] = true;
  return data;
}

/* --------------------------------- Sample --------------------------------- */

export function createSampleData(input: OnboardingInput): { data: DataState; blobs: [ID, Blob][] } {
  const { lang } = input;
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en);
  const data = createEmptyData(lang, input.name);
  data.onboarded = true;
  data.workspace = { name: input.workspaceName || L('Команда продукта', 'Product team'), icon: '🚀' };
  const me = data.people[data.meId];
  me.role = input.role || L('Продакт менеджер', 'Product manager');
  const today = todayISO();
  const d = (n: number) => shiftISO(today, n);
  const ts = nowIso();

  // ---- People
  const person = (name: string, role: string, color: Person['color']): ID => {
    const id = uid('p');
    data.people[id] = { id, name, role, color };
    return id;
  };
  const anna = person(L('Анна Смирнова', 'Anna Carter'), L('Дизайн лид', 'Design lead'), 'purple');
  const dima = person(L('Дмитрий Козлов', 'David Kim'), L('Техлид', 'Tech lead'), 'green');
  const maria = person(L('Мария Иванова', 'Maria Lopez'), L('Маркетинг', 'Marketing'), 'pink');
  const igor = person(L('Игорь Петров', 'Igor Petrov'), L('Бэкенд разработчик', 'Backend engineer'), 'orange');
  const elena = person(L('Елена Соколова', 'Elena Novak'), L('Аналитик', 'Analyst'), 'yellow');

  // ---- Groups (spaces that hold projects)
  const group = (name: string, icon: string, order: number): ID => {
    const id = uid('g');
    data.groups[id] = { id, name, icon, order };
    data.prefs.expanded[`group:${id}`] = true;
    return id;
  };
  const productGroup = group(L('Продукт', 'Product'), '📦', 1);
  const discoveryGroup = group(L('Исследования', 'Discovery'), '🧪', 2);

  // ---- Projects
  const project = (p: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): ID => {
    const id = uid('pr');
    data.projects[id] = { ...p, id, createdAt: ts, updatedAt: ts };
    data.prefs.expanded[`project:${id}`] = false;
    return id;
  };

  const mobile = project({
    name: L('Мобильное приложение 2.0', 'Mobile App 2.0'),
    icon: '📱',
    color: 'blue',
    status: 'on_track',
    leadId: data.meId,
    startDate: d(-45),
    targetDate: d(75),
    summary: L('Удвоить активацию новых пользователей к релизу 2.0', 'Double new user activation by the 2.0 release'),
    plane: { projectId: 'demo-mob', identifier: 'MOB', name: 'Mobile' },
    groupId: productGroup,
    order: 1,
    brief: [
      B.h2(L('Зачем', 'Why')),
      B.p(
        L(
          'Только 31% новых пользователей доходят до первой ценности в приложении. Онбординг длинный, регистрация требует почту и пароль, оплата работает только картой.',
          'Only 31% of new users reach first value in the app. Onboarding is long, sign-up needs email and password, and payment works only with cards.',
        ),
      ),
      B.h2(L('Цели и метрики', 'Goals and metrics')),
      B.li(L('Активация D1: 31% → 55%', 'D1 activation: 31% → 55%')),
      B.li(L('Конверсия в оплату: 3.2% → 5%', 'Paid conversion: 3.2% → 5%')),
      B.li(L('Холодный старт: 2.8 с → 1.5 с', 'Cold start: 2.8s → 1.5s')),
      B.h2(L('Не входит в объем', 'Out of scope')),
      B.li(L('Редизайн главного экрана', 'Home screen redesign')),
      B.li(L('Планшетная версия', 'Tablet layout')),
      B.h2(L('Риски', 'Risks')),
      B.todo(L('Ревью Apple может занять больше недели', 'App Store review may take over a week')),
      B.todo(L('SMS провайдер: нужен резервный', 'SMS provider: need a fallback')),
    ],
  });

  const web = project({
    name: L('Запуск веб-кабинета', 'Web dashboard launch'),
    icon: '🌐',
    color: 'purple',
    status: 'at_risk',
    leadId: data.meId,
    startDate: d(-20),
    targetDate: d(40),
    summary: L('B2B кабинет для команд клиентов', 'A B2B dashboard for customer teams'),
    groupId: productGroup,
    order: 2,
  });

  const research = project({
    name: L('Исследование рынка Q4', 'Q4 market research'),
    icon: '🔭',
    color: 'orange',
    status: 'on_track',
    leadId: elena,
    startDate: d(-7),
    targetDate: d(30),
    summary: L('Понять, куда расти в следующем году', 'Understand where to grow next year'),
    groupId: discoveryGroup,
    order: 1,
  });

  // ---- Items
  let order = 0;
  const item = (p: Partial<Item> & Pick<Item, 'projectId' | 'title' | 'type'>): ID => {
    const id = uid('it');
    data.items[id] = {
      id,
      status: 'backlog',
      priority: 'none',
      tags: [],
      order: order++,
      createdBy: data.meId,
      createdAt: ts,
      updatedAt: ts,
      ...p,
      completedAt: p.status === 'done' ? ts : undefined,
    };
    return id;
  };

  // Mobile: initiatives
  const onb = item({
    projectId: mobile,
    type: 'initiative',
    title: L('Онбординг без трения', 'Frictionless onboarding'),
    status: 'in_progress',
    priority: 'high',
    horizon: 'now',
    startDate: d(-40),
    dueDate: d(20),
    assigneeId: data.meId,
  });
  const pay = item({
    projectId: mobile,
    type: 'initiative',
    title: L('Платежи и подписки', 'Payments and subscriptions'),
    status: 'planned',
    priority: 'high',
    horizon: 'next',
    startDate: d(-5),
    dueDate: d(58),
    assigneeId: data.meId,
  });
  const perf = item({
    projectId: mobile,
    type: 'initiative',
    title: L('Скорость и стабильность', 'Speed and stability'),
    status: 'backlog',
    priority: 'medium',
    horizon: 'later',
    startDate: d(35),
    dueDate: d(95),
    assigneeId: dima,
  });

  const phone = item({
    projectId: mobile,
    parentId: onb,
    type: 'feature',
    title: L('Регистрация по номеру телефона', 'Phone number sign-up'),
    status: 'in_progress',
    priority: 'urgent',
    horizon: 'now',
    startDate: d(-22),
    dueDate: d(4),
    assigneeId: igor,
    estimate: 8,
    tags: ['auth', 'growth'],
    rice: { reach: 4000, impact: 2, confidence: 80, effort: 2 },
    plane: {
      issueId: 'demo-mob-42',
      projectId: 'demo-mob',
      key: 'MOB-42',
      stateName: 'In Progress',
      stateGroup: 'started',
      stateColor: '#f59e0b',
      demo: true,
    },
    content: [
      B.h3(L('Проблема', 'Problem')),
      B.p(L('38% пользователей бросают регистрацию на шаге ввода пароля.', '38% of users drop sign-up at the password step.')),
      B.h3(L('Критерии готовности', 'Acceptance criteria')),
      B.todo(L('Вход по SMS коду за 2 шага', 'SMS code login in 2 steps'), true),
      B.todo(L('Автоподстановка кода на iOS и Android', 'Code autofill on iOS and Android'), true),
      B.todo(L('Резервный SMS провайдер', 'Fallback SMS provider')),
      B.todo(L('События в аналитике: sms_sent, sms_verified', 'Analytics events: sms_sent, sms_verified')),
    ],
  });
  const tour = item({
    projectId: mobile,
    parentId: onb,
    type: 'feature',
    title: L('Интерактивный тур по приложению', 'Interactive app tour'),
    status: 'planned',
    priority: 'high',
    horizon: 'now',
    startDate: d(3),
    dueDate: d(18),
    assigneeId: anna,
    estimate: 5,
    tags: ['growth', 'design'],
    rice: { reach: 2500, impact: 1, confidence: 80, effort: 1 },
  });
  item({
    projectId: mobile,
    parentId: onb,
    type: 'feature',
    title: L('Персонализация первого экрана', 'Personalized first screen'),
    status: 'idea',
    priority: 'medium',
    horizon: 'later',
    tags: ['growth'],
    rice: { reach: 3000, impact: 1, confidence: 50, effort: 3 },
  });
  item({
    projectId: mobile,
    parentId: pay,
    type: 'feature',
    title: L('Apple Pay и Google Pay', 'Apple Pay and Google Pay'),
    status: 'planned',
    priority: 'high',
    horizon: 'next',
    startDate: d(8),
    dueDate: d(34),
    assigneeId: igor,
    estimate: 13,
    tags: ['payments'],
    rice: { reach: 3000, impact: 2, confidence: 50, effort: 3 },
  });
  item({
    projectId: mobile,
    parentId: pay,
    type: 'feature',
    title: L('Экран управления подпиской', 'Subscription management screen'),
    status: 'backlog',
    priority: 'medium',
    horizon: 'next',
    startDate: d(28),
    dueDate: d(52),
    assigneeId: anna,
    estimate: 5,
    tags: ['payments', 'design'],
    rice: { reach: 1800, impact: 1, confidence: 80, effort: 1 },
  });
  const doubleCharge = item({
    projectId: mobile,
    parentId: pay,
    type: 'bug',
    title: L('Двойное списание при повторе оплаты', 'Double charge on payment retry'),
    status: 'in_review',
    priority: 'urgent',
    horizon: 'now',
    dueDate: d(1),
    assigneeId: igor,
    estimate: 3,
    tags: ['payments'],
    plane: {
      issueId: 'demo-mob-57',
      projectId: 'demo-mob',
      key: 'MOB-57',
      stateName: 'In Review',
      stateGroup: 'started',
      stateColor: '#8b5cf6',
      demo: true,
    },
  });
  item({
    projectId: mobile,
    parentId: perf,
    type: 'feature',
    title: L('Холодный старт быстрее 1.5 секунды', 'Cold start under 1.5 seconds'),
    status: 'backlog',
    priority: 'medium',
    horizon: 'later',
    startDate: d(40),
    dueDate: d(80),
    assigneeId: dima,
    estimate: 8,
    tags: ['performance'],
    rice: { reach: 9000, impact: 0.5, confidence: 80, effort: 2 },
  });
  item({
    projectId: mobile,
    parentId: perf,
    type: 'feature',
    title: L('Офлайн режим для ленты', 'Offline mode for the feed'),
    status: 'idea',
    priority: 'low',
    horizon: 'later',
    tags: ['performance'],
    rice: { reach: 1200, impact: 1, confidence: 50, effort: 4 },
  });
  item({
    projectId: mobile,
    type: 'milestone',
    title: L('Бета для 1000 пользователей', 'Beta for 1,000 users'),
    status: 'planned',
    priority: 'high',
    dueDate: d(21),
  });
  item({
    projectId: mobile,
    type: 'milestone',
    title: L('Релиз 2.0 в сторах', '2.0 release in stores'),
    status: 'planned',
    priority: 'urgent',
    dueDate: d(62),
  });
  // Mobile: tasks
  item({
    projectId: mobile,
    parentId: tour,
    type: 'task',
    title: L('Макеты пустых состояний', 'Empty state mockups'),
    status: 'in_progress',
    priority: 'medium',
    dueDate: d(3),
    assigneeId: anna,
    tags: ['design'],
  });
  item({
    projectId: mobile,
    parentId: onb,
    type: 'task',
    title: L('Согласовать тексты онбординга с маркетингом', 'Align onboarding copy with marketing'),
    status: 'planned',
    priority: 'high',
    dueDate: d(1),
    assigneeId: data.meId,
    tags: ['copy'],
  });
  item({
    projectId: mobile,
    type: 'task',
    title: L('Собрать метрики воронки регистрации', 'Pull sign-up funnel metrics'),
    status: 'planned',
    priority: 'high',
    dueDate: d(0),
    assigneeId: data.meId,
    tags: ['analytics'],
  });
  item({
    projectId: mobile,
    type: 'task',
    title: L('Провести 5 интервью с новыми пользователями', 'Run 5 interviews with new users'),
    status: 'backlog',
    priority: 'medium',
    dueDate: d(6),
    assigneeId: data.meId,
    tags: ['research'],
  });
  item({
    projectId: mobile,
    type: 'task',
    title: L('Обновить скриншоты для сторов', 'Refresh store screenshots'),
    status: 'backlog',
    priority: 'low',
    dueDate: d(50),
    assigneeId: maria,
    tags: ['marketing'],
  });
  item({
    projectId: mobile,
    type: 'bug',
    title: L('Падение при повороте экрана на Android 12', 'Crash on screen rotation on Android 12'),
    status: 'in_progress',
    priority: 'high',
    dueDate: d(2),
    assigneeId: igor,
    tags: ['android'],
    plane: {
      issueId: 'demo-mob-61',
      projectId: 'demo-mob',
      key: 'MOB-61',
      stateName: 'In Progress',
      stateGroup: 'started',
      stateColor: '#f59e0b',
      demo: true,
    },
  });
  item({
    projectId: mobile,
    parentId: pay,
    type: 'task',
    title: L('Написать PRD по подпискам', 'Write the subscriptions PRD'),
    status: 'done',
    priority: 'medium',
    dueDate: d(-3),
    assigneeId: data.meId,
    tags: ['docs'],
  });
  item({
    projectId: mobile,
    type: 'task',
    title: L('Договориться о резервном SMS провайдере', 'Agree on a fallback SMS provider'),
    status: 'backlog',
    priority: 'high',
    dueDate: d(5),
    assigneeId: dima,
    tags: ['auth'],
  });

  // Web
  const b2b = item({
    projectId: web,
    type: 'initiative',
    title: L('B2B кабинет', 'B2B dashboard'),
    status: 'in_progress',
    priority: 'high',
    horizon: 'now',
    startDate: d(-18),
    dueDate: d(38),
    assigneeId: data.meId,
  });
  item({
    projectId: web,
    parentId: b2b,
    type: 'feature',
    title: L('Роли и права доступа', 'Roles and permissions'),
    status: 'in_progress',
    priority: 'urgent',
    horizon: 'now',
    startDate: d(-15),
    dueDate: d(6),
    assigneeId: dima,
    estimate: 8,
    tags: ['security'],
    rice: { reach: 600, impact: 3, confidence: 80, effort: 2 },
  });
  item({
    projectId: web,
    parentId: b2b,
    type: 'feature',
    title: L('Экспорт отчетов в Excel', 'Export reports to Excel'),
    status: 'planned',
    priority: 'medium',
    horizon: 'next',
    startDate: d(5),
    dueDate: d(20),
    assigneeId: igor,
    estimate: 3,
    tags: ['reports'],
    rice: { reach: 450, impact: 1, confidence: 100, effort: 0.5 },
  });
  item({
    projectId: web,
    parentId: b2b,
    type: 'feature',
    title: L('SSO через Google Workspace', 'SSO with Google Workspace'),
    status: 'backlog',
    priority: 'high',
    horizon: 'next',
    startDate: d(15),
    dueDate: d(36),
    tags: ['security'],
    rice: { reach: 500, impact: 2, confidence: 50, effort: 1.5 },
  });
  item({
    projectId: web,
    parentId: b2b,
    type: 'feature',
    title: L('Приглашение команды по ссылке', 'Invite a team by link'),
    status: 'idea',
    priority: 'medium',
    horizon: 'later',
    tags: ['growth'],
    rice: { reach: 700, impact: 1, confidence: 80, effort: 1 },
  });
  item({
    projectId: web,
    type: 'milestone',
    title: L('Пилот с тремя клиентами', 'Pilot with three customers'),
    status: 'planned',
    priority: 'high',
    dueDate: d(14),
  });
  item({
    projectId: web,
    type: 'task',
    title: L('Подготовить демо для клиента Альфа', 'Prepare the demo for Alpha Corp'),
    status: 'in_progress',
    priority: 'urgent',
    dueDate: d(1),
    assigneeId: data.meId,
    tags: ['sales'],
  });
  item({
    projectId: web,
    type: 'task',
    title: L('Юридическая проверка договора пилота', 'Legal review of the pilot contract'),
    status: 'planned',
    priority: 'medium',
    dueDate: d(8),
    assigneeId: maria,
  });

  // Research
  item({
    projectId: research,
    type: 'task',
    title: L('Список из 20 конкурентов', 'List of 20 competitors'),
    status: 'done',
    priority: 'medium',
    dueDate: d(-2),
    assigneeId: elena,
    tags: ['research'],
  });
  item({
    projectId: research,
    type: 'task',
    title: L('Опрос 300 клиентов о ценности', 'Survey 300 customers about value'),
    status: 'in_progress',
    priority: 'high',
    startDate: d(-3),
    dueDate: d(9),
    assigneeId: elena,
    tags: ['research'],
  });
  item({
    projectId: research,
    type: 'task',
    title: L('Сегментация рынка и размер TAM', 'Market segmentation and TAM'),
    status: 'planned',
    priority: 'medium',
    startDate: d(8),
    dueDate: d(22),
    assigneeId: data.meId,
    tags: ['research'],
  });
  item({
    projectId: research,
    type: 'milestone',
    title: L('Презентация стратегии на 2027', '2027 strategy presentation'),
    status: 'planned',
    priority: 'high',
    dueDate: d(30),
  });

  // ---- Comments and activity, so the item page feels lived in
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const comment = (targetId: ID, authorId: ID, text: string, minutesAgo: number) => {
    const id = uid('cm');
    data.comments[id] = { id, targetKind: 'item', targetId, authorId, text, createdAt: ago(minutesAgo) };
  };
  comment(phone, dima, L('Автоподстановку кода на Android доделаем к среде.', 'We will finish Android code autofill by Wednesday.'), 190);
  comment(
    phone,
    anna,
    L('Добавила в макет состояния ошибки и таймер повторной отправки.', 'Added error states and the resend timer to the mockup.'),
    48,
  );
  comment(
    doubleCharge,
    igor,
    L('Нашел причину: ретрай без ключа идемпотентности. Фикс на ревью.', 'Found it: retry without an idempotency key. Fix is in review.'),
    95,
  );
  const act = (itemId: ID, actorId: ID, kind: 'created' | 'status', minutesAgo: number, from?: string, to?: string) =>
    data.activity.push({ id: uid('ac'), itemId, actorId, kind, from, to, at: ago(minutesAgo) });
  act(phone, data.meId, 'created', 60 * 24 * 12);
  act(phone, data.meId, 'status', 60 * 24 * 9, 'backlog', 'planned');
  act(phone, igor, 'status', 60 * 24 * 6, 'planned', 'in_progress');
  act(doubleCharge, elena, 'created', 60 * 24 * 3);
  act(doubleCharge, igor, 'status', 60 * 5, 'in_progress', 'in_review');

  // ---- Sprints: two finished, one running, one being planned
  const sprint = (name: string, start: number, end: number, status: Sprint['status'], extra: Partial<Sprint> = {}): ID => {
    const id = uid('sp');
    data.sprints[id] = { id, projectId: mobile, name, startDate: d(start), endDate: d(end), status, createdAt: ts, updatedAt: ts, ...extra };
    return id;
  };
  sprint(L('Спринт 13', 'Sprint 13'), -34, -21, 'completed', {
    completedCount: 9,
    completedAt: ago(60 * 24 * 21),
    goal: L('Новый экран онбординга в проде', 'New onboarding screen in production'),
  });
  sprint(L('Спринт 14', 'Sprint 14'), -20, -7, 'completed', {
    completedCount: 11,
    completedAt: ago(60 * 24 * 7),
    goal: L('Стабилизировать запуск и починить краши', 'Stabilize startup and fix crashes'),
  });
  const currentSprint = sprint(L('Спринт 15', 'Sprint 15'), -6, 7, 'active', {
    goal: L('Вход по номеру телефона в бете и фикс двойного списания', 'Phone sign-up in beta and the double charge fixed'),
  });
  const nextSprint = sprint(L('Спринт 16', 'Sprint 16'), 8, 21, 'planned', {
    goal: L('Apple Pay и Google Pay для 10% пользователей', 'Apple Pay and Google Pay for 10% of users'),
  });
  let doneDaysAgo = 5;
  for (const it of Object.values(data.items)) {
    if (it.projectId !== mobile || it.type === 'initiative' || it.type === 'milestone') continue;
    if (it.status === 'done') {
      it.sprintId = currentSprint;
      it.completedAt = ago(60 * 24 * doneDaysAgo);
      doneDaysAgo = Math.max(1, doneDaysAgo - 2);
    } else if (it.status === 'in_progress' || it.status === 'in_review' || (it.status === 'planned' && !!it.dueDate && it.dueDate <= d(7))) {
      it.sprintId = currentSprint;
    } else if (it.status === 'planned' || (it.status === 'backlog' && (it.priority === 'high' || it.priority === 'urgent'))) {
      it.sprintId = nextSprint;
    }
  }

  // ---- Inbox: what teammates sent your way while you were away
  const myName = data.people[data.meId].name;
  const mentionText = L(
    `@${myName}, посмотри состояния ошибки в макете. Если ок, отдаю в разработку.`,
    `@${myName}, could you check the error states in the mockup? If it looks good I will hand it off.`,
  );
  const mentionId = uid('cm');
  data.comments[mentionId] = { id: mentionId, targetKind: 'item', targetId: phone, authorId: anna, text: mentionText, mentions: [data.meId], createdAt: ago(22) };
  const metrics = Object.values(data.items).find((i) => i.assigneeId === data.meId && i.type === 'task' && i.dueDate === d(0));
  const notify = (n: Omit<AppNotification, 'id' | 'recipientId' | 'createdAt'> & { minutesAgo: number; read?: boolean }) => {
    const id = uid('nt');
    const { minutesAgo, read, ...rest } = n;
    data.notifications[id] = { ...rest, id, recipientId: data.meId, createdAt: ago(minutesAgo), ...(read ? { readAt: ago(minutesAgo - 1) } : {}) };
  };
  notify({ kind: 'mention', actorId: anna, targetKind: 'item', targetId: phone, projectId: mobile, text: mentionText, minutesAgo: 22 });
  if (metrics) notify({ kind: 'assigned', actorId: dima, targetKind: 'item', targetId: metrics.id, projectId: mobile, minutesAgo: 70 });
  notify({
    kind: 'comment',
    actorId: igor,
    targetKind: 'item',
    targetId: doubleCharge,
    projectId: mobile,
    text: L('Нашел причину: ретрай без ключа идемпотентности. Фикс на ревью.', 'Found it: retry without an idempotency key. Fix is in review.'),
    minutesAgo: 95,
  });
  notify({ kind: 'status', actorId: igor, targetKind: 'item', targetId: doubleCharge, projectId: mobile, text: 'in_review', minutesAgo: 300, read: true });
  notify({ kind: 'status', actorId: anna, targetKind: 'item', targetId: tour, projectId: mobile, text: 'planned', minutesAgo: 60 * 26, read: true });
  notify({
    kind: 'sprint',
    actorId: dima,
    targetKind: 'project',
    targetId: mobile,
    projectId: mobile,
    text: data.sprints[currentSprint].name,
    minutesAgo: 60 * 24 * 6,
    read: true,
  });

  // ---- Docs
  const doc = (p: Omit<Doc, 'id' | 'createdAt' | 'updatedAt' | 'order'>): ID => {
    const id = uid('dc');
    data.docs[id] = { ...p, id, order: Object.keys(data.docs).length + 1, createdAt: ts, updatedAt: ts };
    return id;
  };
  doc({
    projectId: mobile,
    title: L('PRD: Платежи и подписки', 'PRD: Payments and subscriptions'),
    icon: '💳',
    content: [
      B.h2(L('Контекст', 'Context')),
      B.p(L('Сейчас оплата доступна только картой, конверсия в оплату 3.2%.', 'Today payment is card-only and paid conversion is 3.2%.')),
      B.h2(L('Пользовательские истории', 'User stories')),
      B.li(L('Как пользователь iPhone, я хочу оплатить через Apple Pay в одно касание', 'As an iPhone user I want to pay with Apple Pay in one tap')),
      B.li(
        L('Как подписчик, я хочу поменять тариф без обращения в поддержку', 'As a subscriber I want to change my plan without contacting support'),
      ),
      B.h2(L('Метрики успеха', 'Success metrics')),
      B.li(L('Конверсия в оплату 5%', 'Paid conversion 5%')),
      B.li(L('Обращения в поддержку по оплате: минус 30%', 'Payment support tickets: minus 30%')),
      B.h2(L('Открытые вопросы', 'Open questions')),
      B.todo(L('Нужна ли поддержка семейных подписок в первой версии?', 'Do we need family plans in v1?')),
    ],
  });
  doc({
    projectId: mobile,
    title: L('Ретро спринта 14', 'Sprint 14 retro'),
    icon: '🔄',
    content: [
      B.h3(L('Что было хорошо', 'What went well')),
      B.li(L('Быстро починили краш на старте', 'Fixed the startup crash quickly')),
      B.h3(L('Что улучшить', 'What to improve')),
      B.li(L('Поздно подключили дизайн к задачам по оплате', 'Design joined payment tasks too late')),
      B.h3(L('Действия', 'Actions')),
      B.todo(L('Дизайн ревью на этапе PRD', 'Design review at the PRD stage')),
    ],
  });
  doc({
    projectId: web,
    title: L('Скоуп пилота', 'Pilot scope'),
    icon: '🧭',
    content: [
      B.p(L('Три клиента, 4 недели, роли админ и участник, экспорт в Excel.', 'Three customers, 4 weeks, admin and member roles, Excel export.')),
    ],
  });
  const principles = doc({
    title: L('Принципы продукта', 'Product principles'),
    icon: '✨',
    content: [
      B.quote(L('Мы делаем меньше, но лучше.', 'We do fewer things, better.')),
      B.h2(L('1. Ценность за первые 60 секунд', '1. Value in the first 60 seconds')),
      B.p(
        L('Каждый новый пользователь должен получить результат до того, как устанет.', 'Every new user should get a result before they get tired.'),
      ),
      B.h2(L('2. Решения на данных, но не только', '2. Data-informed, not data-driven')),
      B.p(L('Цифры показывают что, интервью объясняют почему.', 'Numbers show what, interviews explain why.')),
      B.h2(L('3. Скорость важнее идеальности', '3. Speed over perfection')),
      B.p(L('Выпускаем маленькими шагами и учимся на реальных пользователях.', 'Ship in small steps and learn from real users.')),
    ],
  });
  doc({
    parentId: principles,
    title: L('Как мы пишем PRD', 'How we write PRDs'),
    icon: '📝',
    content: [
      B.ol(L('Проблема и доказательства', 'Problem and evidence')),
      B.ol(L('Цели и метрики', 'Goals and metrics')),
      B.ol(L('Пользовательские истории', 'User stories')),
      B.ol(L('Что не делаем', 'Non-goals')),
      B.ol(L('Риски и открытые вопросы', 'Risks and open questions')),
    ],
  });
  doc({
    title: L('Заметки 1:1 с Дмитрием', '1:1 notes with David'),
    icon: '☕',
    content: [B.todo(L('Обсудить найм второго мобильного разработчика', 'Discuss hiring a second mobile engineer'))],
  });

  // ---- Plane demo snapshot for the mobile project
  const states: PlaneStateLite[] = [
    { id: 's-backlog', name: 'Backlog', color: '#a3a3a3', group: 'backlog' },
    { id: 's-todo', name: 'Todo', color: '#3b82f6', group: 'unstarted' },
    { id: 's-progress', name: 'In Progress', color: '#f59e0b', group: 'started' },
    { id: 's-review', name: 'In Review', color: '#8b5cf6', group: 'started' },
    { id: 's-done', name: 'Done', color: '#16a34a', group: 'completed' },
    { id: 's-cancel', name: 'Cancelled', color: '#ef4444', group: 'cancelled' },
  ];
  const issueNames = L(
    'Экран ввода кода|Таймер повторной отправки SMS|Валидация номера|Метрики sms_sent|Автоподстановка кода Android|Экран приветствия тура|Анимации тура|Локализация тура|Логирование ошибок оплаты|Идемпотентность платежей|Ретраи вебхуков|Фикс поворота экрана|Обновить SDK аналитики|Кэш изображений|Уменьшить размер бандла|Юнит тесты авторизации|Темная тема тура|Deep link из push|Экран ошибки сети|Обновить иконку приложения|Проверка доступности|Скриншот тесты|Health check SMS провайдера|Релизный чеклист',
    'Code input screen|SMS resend timer|Phone validation|sms_sent metrics|Android code autofill|Tour welcome screen|Tour animations|Tour localization|Payment error logging|Payment idempotency|Webhook retries|Rotation crash fix|Update analytics SDK|Image cache|Reduce bundle size|Auth unit tests|Tour dark theme|Deep link from push|Network error screen|Update app icon|Accessibility pass|Screenshot tests|SMS provider health check|Release checklist',
  ).split('|');
  const stateCycle = [
    's-done',
    's-done',
    's-progress',
    's-done',
    's-progress',
    's-todo',
    's-todo',
    's-backlog',
    's-done',
    's-review',
    's-todo',
    's-progress',
    's-done',
    's-backlog',
    's-backlog',
    's-done',
    's-backlog',
    's-todo',
    's-todo',
    's-done',
    's-backlog',
    's-todo',
    's-progress',
    's-backlog',
  ];
  const issues: PlaneIssueLite[] = issueNames.map((name, i) => ({
    id: `demo-issue-${i}`,
    name,
    sequenceId: 30 + i,
    stateId: stateCycle[i],
    priority: (['high', 'medium', 'urgent', 'low', 'medium', 'none'] as const)[i % 6],
    updatedAt: ts,
  }));
  issues.push(
    { id: 'demo-mob-42', name: data.items[phone].title, sequenceId: 42, stateId: 's-progress', priority: 'urgent' },
    { id: 'demo-mob-57', name: data.items[doubleCharge].title, sequenceId: 57, stateId: 's-review', priority: 'urgent' },
    {
      id: 'demo-mob-61',
      name: L('Падение при повороте экрана на Android 12', 'Crash on screen rotation on Android 12'),
      sequenceId: 61,
      stateId: 's-progress',
      priority: 'high',
    },
  );
  const snap: PlaneSnapshot = {
    projectId: 'demo-mob',
    identifier: 'MOB',
    issues,
    states,
    cycles: [
      { id: 'c-13', name: 'Sprint 13', startDate: d(-28), endDate: d(-15), total: 21, completed: 19 },
      { id: 'c-14', name: 'Sprint 14', startDate: d(-14), endDate: d(-1), total: 24, completed: 20 },
      { id: 'c-15', name: 'Sprint 15', startDate: d(0), endDate: d(13), total: 18, completed: 7 },
    ],
    syncedAt: ts,
    demo: true,
  };
  data.plane.snapshots[mobile] = snap;

  // ---- Map
  const map = generateProjectMap(data.projects[mobile], Object.values(data.items));
  const maxX = Math.max(...map.nodes.map((n) => n.x));
  map.nodes.push(
    { id: uid('n'), kind: 'risk', text: L('Один SMS провайдер', 'Single SMS provider'), x: -320, y: 20 },
    { id: uid('n'), kind: 'risk', text: L('Ревью App Store дольше недели', 'App Store review over a week'), x: -320, y: 150 },
    { id: uid('n'), kind: 'person', personId: maria, text: L('Мария: тексты и кампания', 'Maria: copy and campaign'), x: maxX + 420, y: 330 },
    {
      id: uid('n'),
      kind: 'note',
      text: L('Гипотеза: SMS вход поднимет активацию на 15 п.п.', 'Hypothesis: SMS login lifts activation by 15 pp'),
      x: -320,
      y: 300,
    },
  );
  data.maps[mobile] = { ...map, updatedAt: ts };

  // ---- Files: folders, links (Plaud recordings live in Plaud, we keep links) and a few real files
  const blobs: [ID, Blob][] = [];
  const node = ({ daysAgo = 3, ...n }: Omit<FileNode, 'id' | 'createdAt' | 'updatedAt'> & { daysAgo?: number }): ID => {
    const id = uid(n.kind === 'folder' ? 'fd' : n.kind === 'link' ? 'ln' : 'f');
    const at = new Date(Date.now() - daysAgo * 86400000).toISOString();
    data.files[id] = { ...n, id, createdAt: at, updatedAt: at };
    return id;
  };
  const textFile = (name: string, mime: string, content: string, parent: { projectId?: ID; parentId?: ID }, daysAgo: number) => {
    const blob = new Blob([content], { type: mime });
    const id = node({ kind: 'file', name, mime, size: blob.size, ...parent, daysAgo });
    blobs.push([id, blob]);
    return id;
  };

  const researchFolder = node({ kind: 'folder', name: L('Исследования', 'Research'), projectId: mobile, daysAgo: 12 });
  const design = node({ kind: 'folder', name: L('Дизайн', 'Design'), projectId: mobile, daysAgo: 10 });
  node({
    kind: 'link',
    name: L('Интервью с новыми пользователями', 'Interviews with new users'),
    url: 'https://web.plaud.ai/',
    note: L('Запись Plaud: 5 интервью про регистрацию', 'Plaud recording: 5 sign-up interviews'),
    projectId: mobile,
    parentId: researchFolder,
    daysAgo: 6,
  });
  textFile(
    L('Сводка интервью.md', 'Interview digest.md'),
    'text/markdown',
    L(
      '# Сводка интервью\n\n- 4 из 5 бросали регистрацию на пароле\n- Все ждут вход по номеру телефона\n- Тур полезен, если он короче минуты\n',
      '# Interview digest\n\n- 4 of 5 dropped sign-up at the password step\n- Everyone expects phone sign-in\n- The tour helps if it is under a minute\n',
    ),
    { projectId: mobile, parentId: researchFolder },
    5,
  );
  textFile(
    L('Воронка регистрации.csv', 'Sign-up funnel.csv'),
    'text/csv',
    L(
      'шаг,пользователи,конверсия\nустановка,10000,100%\nэкран входа,7400,74%\nпароль,4600,46%\nактивация,3100,31%\n',
      'step,users,conversion\ninstall,10000,100%\nsign-in screen,7400,74%\npassword,4600,46%\nactivation,3100,31%\n',
    ),
    { projectId: mobile, parentId: researchFolder },
    4,
  );
  node({
    kind: 'link',
    name: L('Макеты онбординга', 'Onboarding mockups'),
    url: 'https://www.figma.com/',
    projectId: mobile,
    parentId: design,
    daysAgo: 3,
  });
  textFile(
    L('Экран входа по SMS.svg', 'SMS sign-in screen.svg'),
    'image/svg+xml',
    mockupSvg(L('Вход по номеру', 'Sign in with phone'), L('Получить код', 'Get code')),
    { projectId: mobile, parentId: design },
    2,
  );
  node({
    kind: 'link',
    name: L('Планирование спринта: онбординг', 'Sprint planning: onboarding'),
    url: 'https://web.plaud.ai/',
    note: L('Запись Plaud со встречи команды', 'Plaud recording of the team meeting'),
    projectId: mobile,
    daysAgo: 2,
  });
  node({ kind: 'link', name: L('Спецификация API платежей', 'Payments API spec'), url: 'https://docs.google.com/', projectId: mobile, daysAgo: 8 });

  const pilot = node({ kind: 'folder', name: L('Пилот', 'Pilot'), projectId: web, daysAgo: 9 });
  node({
    kind: 'link',
    name: L('Синк по B2B кабинету', 'B2B dashboard sync'),
    url: 'https://web.plaud.ai/',
    note: L('Запись Plaud', 'Plaud recording'),
    projectId: web,
    parentId: pilot,
    daysAgo: 1,
  });
  textFile(
    L('Скоуп пилота.txt', 'Pilot scope.txt'),
    'text/plain',
    L('Три клиента, четыре недели, роли админ и участник, экспорт в Excel.', 'Three customers, four weeks, admin and member roles, Excel export.'),
    { projectId: web, parentId: pilot },
    7,
  );

  node({ kind: 'folder', name: L('Шаблоны', 'Templates'), daysAgo: 20 });
  node({ kind: 'link', name: L('Все записи в Plaud', 'All recordings in Plaud'), url: 'https://web.plaud.ai/', daysAgo: 14 });
  textFile(
    L('Продуктовая стратегия 2026.md', 'Product strategy 2026.md'),
    'text/markdown',
    L('# Стратегия 2026\n\n1. Активация\n2. Монетизация\n3. B2B\n', '# Strategy 2026\n\n1. Activation\n2. Monetization\n3. B2B\n'),
    {},
    11,
  );

  // ---- Prefs
  data.prefs.expanded[`project:${mobile}`] = true;
  data.prefs.favorites = [
    { kind: 'project', id: mobile },
    { kind: 'doc', id: principles },
  ];
  data.prefs.recent = [
    { kind: 'project', id: mobile, at: ts },
    { kind: 'doc', id: principles, at: ts },
    { kind: 'project', id: web, at: ts },
  ];
  return { data, blobs };
}

/** A simple phone mockup so the sample drive has a real image to preview. */
function mockupSvg(title: string, button: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="780" viewBox="0 0 390 780">
<rect width="390" height="780" rx="48" fill="#f7f7f5"/>
<rect x="24" y="24" width="342" height="732" rx="36" fill="#ffffff" stroke="#e6e6e3"/>
<rect x="155" y="44" width="80" height="8" rx="4" fill="#e6e6e3"/>
<circle cx="195" cy="190" r="44" fill="#2383e2" opacity="0.12"/>
<path d="M178 190l12 12 22-24" fill="none" stroke="#2383e2" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<text x="195" y="290" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="700" fill="#37352f">${title}</text>
<rect x="56" y="340" width="278" height="56" rx="14" fill="#f1f1ef"/>
<text x="76" y="375" font-family="Inter, Arial, sans-serif" font-size="18" fill="#787774">+7 (___) ___-__-__</text>
<rect x="56" y="420" width="278" height="56" rx="14" fill="#2383e2"/>
<text x="195" y="455" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600" fill="#ffffff">${button}</text>
</svg>`;
}
