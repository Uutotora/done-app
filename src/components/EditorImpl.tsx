import { useMemo } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import * as locales from '@blocknote/core/locales';
import '@blocknote/mantine/style.css';
import type { PartialBlock } from '@blocknote/core';
import { useDebouncedCallback, useIsDark } from '@/lib/hooks';
import { useLang } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { EditorProps } from './Editor';

const MAX_INLINE_IMAGE = 3 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function EditorImpl({ initial, onChange, placeholder, compact, editable = true, className }: EditorProps) {
  const lang = useLang();
  const dark = useIsDark();
  const dictionary = useMemo(() => {
    const base = lang === 'ru' ? locales.ru : locales.en;
    return {
      ...base,
      placeholders: { ...base.placeholders, emptyDocument: placeholder ?? base.placeholders.default },
    };
  }, [lang, placeholder]);

  const editor = useCreateBlockNote(
    {
      initialContent: initial && initial.length ? (initial as PartialBlock[]) : undefined,
      dictionary,
      // Images are stored inline so documents stay self-contained in local storage.
      uploadFile: async (file: File) => {
        if (file.size > MAX_INLINE_IMAGE) throw new Error('File is too large');
        return fileToDataUrl(file);
      },
    },
    [dictionary],
  );

  const save = useDebouncedCallback(() => onChange(editor.document as unknown[]), 350);

  return (
    <div className={cn('done-editor -mx-[54px]', compact && 'compact', className)}>
      <BlockNoteView editor={editor} theme={dark ? 'dark' : 'light'} editable={editable} onChange={save} />
    </div>
  );
}
