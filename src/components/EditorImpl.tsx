import { useMemo, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import * as locales from '@blocknote/core/locales';
import '@blocknote/mantine/style.css';
import type { PartialBlock } from '@blocknote/core';
import { useDebouncedCallback, useIsDark } from '@/lib/hooks';
import { uploadErrorText } from '@/lib/files';
import { translate, useLang } from '@/lib/i18n';
import { MAX_INLINE_UPLOAD_MB, UploadError, isRemoteStorage, uploadEditorFile } from '@/lib/storage';
import { toast } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { EditorProps } from './Editor';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function EditorImpl({ initial, onChange, placeholder, compact, editable = true, className, projectId }: EditorProps) {
  const lang = useLang();
  // Read when a file is inserted, so a task moved to another project uploads there.
  const scope = useRef(projectId);
  scope.current = projectId;
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
      // With an account, images and files go to the server and the text keeps only their address.
      // The local demo stores them inline, so its documents stay self-contained.
      uploadFile: async (file: File) => {
        try {
          if (isRemoteStorage()) return await uploadEditorFile(file, scope.current);
          if (file.size > MAX_INLINE_UPLOAD_MB * 1024 * 1024) throw new UploadError('too_large', MAX_INLINE_UPLOAD_MB);
          return await fileToDataUrl(file);
        } catch (error) {
          toast({ message: uploadErrorText(error, (key, vars) => translate(lang, key, vars)), tone: 'error' });
          throw error;
        }
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
