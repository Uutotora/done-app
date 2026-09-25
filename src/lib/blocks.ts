import type { Lang } from './types';

/** Tiny helpers to build BlockNote documents (PartialBlock JSON). */
export const B = {
  h1: (text: string) => ({ type: 'heading', props: { level: 1 }, content: text }),
  h2: (text: string) => ({ type: 'heading', props: { level: 2 }, content: text }),
  h3: (text: string) => ({ type: 'heading', props: { level: 3 }, content: text }),
  p: (text = '') => ({ type: 'paragraph', content: text }),
  li: (text: string) => ({ type: 'bulletListItem', content: text }),
  ol: (text: string) => ({ type: 'numberedListItem', content: text }),
  todo: (text: string, checked = false) => ({ type: 'checkListItem', props: { checked }, content: text }),
  quote: (text: string) => ({ type: 'quote', content: text }),
  bold: (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: { bold: true } }] }),
  muted: (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: { textColor: 'gray' } }] }),
};

export type TemplateId = 'prd' | 'brief' | 'retro' | 'release' | 'oneOnOne' | 'decision';

export interface Template {
  id: TemplateId;
  icon: string;
  title: string;
  content: unknown[];
}

export function templates(lang: Lang): Template[] {
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en);
  return [
    {
      id: 'prd',
      icon: '📝',
      title: L('PRD: ', 'PRD: '),
      content: [
        B.muted(L('Владелец: · Статус: черновик · Ревьюеры:', 'Owner: · Status: draft · Reviewers:')),
        B.h2(L('Проблема', 'Problem')),
        B.p(L('Какую боль пользователя решаем и откуда мы о ней знаем?', 'Which user pain do we solve and how do we know it exists?')),
        B.h2(L('Цели и метрики', 'Goals and metrics')),
        B.li(L('Главная метрика: ', 'Primary metric: ')),
        B.li(L('Контрольные метрики: ', 'Guardrail metrics: ')),
        B.h2(L('Пользовательские истории', 'User stories')),
        B.li(L('Как <роль>, я хочу <действие>, чтобы <ценность>', 'As a <role>, I want <action> so that <value>')),
        B.h2(L('Требования', 'Requirements')),
        B.todo(L('Обязательно: ', 'Must have: ')),
        B.todo(L('Желательно: ', 'Nice to have: ')),
        B.h2(L('Что не делаем', 'Non-goals')),
        B.li(''),
        B.h2(L('Риски и открытые вопросы', 'Risks and open questions')),
        B.todo(''),
      ],
    },
    {
      id: 'brief',
      icon: '🎯',
      title: L('Бриф: ', 'Brief: '),
      content: [
        B.h2(L('Зачем', 'Why')),
        B.p(''),
        B.h2(L('Для кого', 'For whom')),
        B.p(''),
        B.h2(L('Как поймем, что получилось', 'How we will know it worked')),
        B.li(''),
        B.h2(L('Сроки и команда', 'Timeline and team')),
        B.p(''),
      ],
    },
    {
      id: 'retro',
      icon: '🔄',
      title: L('Ретро: ', 'Retro: '),
      content: [
        B.h3(L('Что было хорошо', 'What went well')),
        B.li(''),
        B.h3(L('Что можно улучшить', 'What to improve')),
        B.li(''),
        B.h3(L('Действия', 'Actions')),
        B.todo(''),
      ],
    },
    {
      id: 'release',
      icon: '🚀',
      title: L('Релиз ', 'Release '),
      content: [
        B.muted(L('Дата релиза: · Платформы:', 'Release date: · Platforms:')),
        B.h2(L('Что нового', 'What is new')),
        B.li(''),
        B.h2(L('Исправления', 'Fixes')),
        B.li(''),
        B.h2(L('Для кого важно', 'Who should care')),
        B.p(''),
      ],
    },
    {
      id: 'oneOnOne',
      icon: '☕',
      title: L('1:1 с ', '1:1 with '),
      content: [B.h3(L('Повестка', 'Agenda')), B.todo(''), B.h3(L('Договоренности', 'Agreements')), B.todo(''), B.h3(L('Заметки', 'Notes')), B.p('')],
    },
    {
      id: 'decision',
      icon: '⚖️',
      title: L('Решение: ', 'Decision: '),
      content: [
        B.muted(L('Статус: предложено · Дата:', 'Status: proposed · Date:')),
        B.h2(L('Контекст', 'Context')),
        B.p(''),
        B.h2(L('Варианты', 'Options')),
        B.ol(L('Вариант A: плюсы, минусы', 'Option A: pros, cons')),
        B.ol(L('Вариант B: плюсы, минусы', 'Option B: pros, cons')),
        B.h2(L('Решение и почему', 'Decision and why')),
        B.p(''),
      ],
    },
  ];
}
