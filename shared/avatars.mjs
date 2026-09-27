/** The order matches the six-column, four-row illustration atlas. Keep ids stable. */
export const ANIMAL_AVATARS = [
  { id: 'cat', ru: 'Кот', en: 'Cat' },
  { id: 'dog', ru: 'Пёс', en: 'Dog' },
  { id: 'fox', ru: 'Лиса', en: 'Fox' },
  { id: 'bear', ru: 'Медведь', en: 'Bear' },
  { id: 'rabbit', ru: 'Кролик', en: 'Rabbit' },
  { id: 'panda', ru: 'Панда', en: 'Panda' },
  { id: 'koala', ru: 'Коала', en: 'Koala' },
  { id: 'frog', ru: 'Лягушка', en: 'Frog' },
  { id: 'pig', ru: 'Поросёнок', en: 'Pig' },
  { id: 'cow', ru: 'Корова', en: 'Cow' },
  { id: 'mouse', ru: 'Мышь', en: 'Mouse' },
  { id: 'hedgehog', ru: 'Ёж', en: 'Hedgehog' },
  { id: 'owl', ru: 'Сова', en: 'Owl' },
  { id: 'penguin', ru: 'Пингвин', en: 'Penguin' },
  { id: 'raccoon', ru: 'Енот', en: 'Raccoon' },
  { id: 'tiger', ru: 'Тигр', en: 'Tiger' },
  { id: 'lion', ru: 'Лев', en: 'Lion' },
  { id: 'wolf', ru: 'Волк', en: 'Wolf' },
  { id: 'otter', ru: 'Выдра', en: 'Otter' },
  { id: 'elephant', ru: 'Слон', en: 'Elephant' },
  { id: 'monkey', ru: 'Обезьяна', en: 'Monkey' },
  { id: 'sloth', ru: 'Ленивец', en: 'Sloth' },
  { id: 'deer', ru: 'Олень', en: 'Deer' },
  { id: 'capybara', ru: 'Капибара', en: 'Capybara' },
];

const values = ANIMAL_AVATARS.map(({ id }) => `animal:${id}`);

export const isAnimalAvatar = (value) => typeof value === 'string' && values.includes(value);

/** Existing emoji values stay valid; only known atlas ids may use the reserved prefix. */
export const isValidAvatar = (value) =>
  value == null || (typeof value === 'string' && value.length <= 64 && (!value.startsWith('animal:') || isAnimalAvatar(value)));

/** An old profile gets the same animal on every device, without changing its saved data. */
export function defaultAnimalAvatar(id) {
  let hash = 2166136261;
  for (const character of String(id)) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return values[(hash >>> 0) % values.length];
}

/** Pick once when creating a profile, then persist the returned id. */
export function randomAnimalAvatar(exclude) {
  const choices = values.filter((value) => value !== exclude);
  return choices[Math.floor(Math.random() * choices.length)];
}
