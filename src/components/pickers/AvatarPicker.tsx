import { Check, Shuffle, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { ANIMAL_AVATARS, isAnimalAvatar, personAnimalAvatar, randomAnimalAvatar } from '@/lib/avatars';
import { useLang } from '@/lib/i18n';
import type { Person } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Avatar, Segmented } from '@/components/ui/bits';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';

const EMOJIS = [
  ['🙂', 'Улыбка', 'Smile'],
  ['😎', 'Очки', 'Sunglasses'],
  ['🤓', 'Знаток', 'Nerd'],
  ['🧑‍🚀', 'Космонавт', 'Astronaut'],
  ['🐱', 'Кот', 'Cat'],
  ['🦊', 'Лиса', 'Fox'],
  ['🐼', 'Панда', 'Panda'],
  ['🐸', 'Лягушка', 'Frog'],
  ['🦉', 'Сова', 'Owl'],
  ['🐧', 'Пингвин', 'Penguin'],
  ['🦁', 'Лев', 'Lion'],
  ['🦥', 'Ленивец', 'Sloth'],
  ['🌱', 'Росток', 'Seedling'],
  ['🌻', 'Подсолнух', 'Sunflower'],
  ['🌵', 'Кактус', 'Cactus'],
  ['🍄', 'Гриб', 'Mushroom'],
  ['☀️', 'Солнце', 'Sun'],
  ['🌙', 'Луна', 'Moon'],
  ['⭐', 'Звезда', 'Star'],
  ['🌈', 'Радуга', 'Rainbow'],
  ['🚀', 'Ракета', 'Rocket'],
  ['🎨', 'Палитра', 'Palette'],
  ['🎧', 'Наушники', 'Headphones'],
  ['💡', 'Идея', 'Idea'],
];

/** Selection remains a draft until Save; the dialog never changes another person's profile. */
export function AvatarPicker({
  person,
  open,
  onOpenChange,
  onSelect,
}: {
  person: Person;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (avatar: string) => void;
}) {
  const ru = useLang() === 'ru';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-[416px]" title={ru ? 'Выберите аватар' : 'Choose an avatar'}>
      {open && <AvatarOptions person={person} onClose={() => onOpenChange(false)} onSelect={onSelect} />}
    </Dialog>
  );
}

function AvatarOptions({ person, onClose, onSelect }: { person: Person; onClose: () => void; onSelect: (value: string) => void }) {
  const ru = useLang() === 'ru';
  const [selected, setSelected] = useState(person.avatar || personAnimalAvatar(person));
  const [tab, setTab] = useState<'animals' | 'emoji'>(isAnimalAvatar(selected) ? 'animals' : 'emoji');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const title = ru ? 'Выберите аватар' : 'Choose an avatar';
  const choices =
    tab === 'animals'
      ? ANIMAL_AVATARS.map((animal) => ({ value: `animal:${animal.id}`, label: ru ? animal.ru : animal.en }))
      : [
          ...(person.avatar && !isAnimalAvatar(person.avatar) && !EMOJIS.some(([value]) => value === person.avatar)
            ? [{ value: person.avatar, label: ru ? 'Ваш эмодзи' : 'Your emoji' }]
            : []),
          ...EMOJIS.map(([value, russian, english]) => ({ value, label: ru ? russian : english })),
        ];
  const active = choices.findIndex(({ value }) => value === selected);
  const keyboardSelect = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const shifts: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 };
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = choices.length - 1;
    else if (event.key in shifts) next = (index + shifts[event.key] + choices.length) % choices.length;
    else return;
    event.preventDefault();
    setSelected(choices[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div className="max-h-[84vh] overflow-y-auto p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[19px] font-semibold tracking-[-.02em]">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={ru ? 'Закрыть' : 'Close'}
          className="flex h-8 w-8 items-center justify-center rounded-md text-fg-3 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={18} />
        </button>
      </div>
      <div className="my-5 flex items-center gap-3.5">
        <Avatar person={{ ...person, photo: undefined, avatar: selected }} size={56} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium">{person.name}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-fg-3">
            {ru ? 'Маленькая деталь. Большая индивидуальность.' : 'A small detail. A little more you.'}
          </p>
        </div>
      </div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'animals', label: ru ? 'Зверьки' : 'Animals' },
            { value: 'emoji', label: ru ? 'Эмодзи' : 'Emoji' },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<Shuffle size={14} />}
          onClick={() => {
            setSelected(randomAnimalAvatar(selected));
            setTab('animals');
          }}
        >
          {ru ? 'Случайный' : 'Random'}
        </Button>
      </div>
      <div
        role="radiogroup"
        aria-label={tab === 'animals' ? (ru ? 'Аватары животных' : 'Animal avatars') : ru ? 'Эмодзи' : 'Emoji'}
        className="grid grid-cols-6 gap-1.5"
      >
        {choices.map(({ value, label }, index) => (
          <button
            key={value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected === value}
            aria-label={label}
            title={label}
            tabIndex={index === (active < 0 ? 0 : active) ? 0 : -1}
            onClick={() => setSelected(value)}
            onKeyDown={(event) => keyboardSelect(event, index)}
            className={cn(
              'relative flex aspect-square items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              selected === value ? 'border-fg bg-hover' : 'border-transparent hover:border-line-strong hover:bg-hover',
            )}
          >
            <span aria-hidden>
              <Avatar person={{ ...person, photo: undefined, avatar: value }} size={38} />
            </span>
            {selected === value && (
              <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-fg text-bg">
                <Check size={10} strokeWidth={3} />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mb-5 mt-4 text-[12px] leading-relaxed text-fg-3">
        {person.photo
          ? ru
            ? 'Новый аватар заменит фото профиля. Фото всегда можно загрузить снова.'
            : 'Your new avatar will replace your profile photo. You can upload a photo again anytime.'
          : ru
            ? 'Аватар появится рядом с вашим именем в команде, задачах и комментариях.'
            : 'Your avatar appears beside your name in your team, tasks, and comments.'}
      </p>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onClose}>
          {ru ? 'Отмена' : 'Cancel'}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onSelect(selected);
            onClose();
          }}
        >
          {ru ? 'Сохранить' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
