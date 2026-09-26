import { lazy, Suspense } from 'react';
import { useProjectLevel } from '@/lib/auth';
import { cn } from '@/lib/utils';

export interface EditorProps {
  /** BlockNote document JSON. */
  initial?: unknown[];
  onChange: (blocks: unknown[]) => void;
  placeholder?: string;
  compact?: boolean;
  editable?: boolean;
  className?: string;
  /** Project the text belongs to; without edit access there the editor is read-only. */
  projectId?: string;
}

const EditorImpl = lazy(() => import('./EditorImpl'));

/** Notion-style block editor (BlockNote), loaded on demand to keep the first paint light. */
export function Editor(props: EditorProps) {
  const level = useProjectLevel(props.projectId);
  const readOnly = level !== 'editor' && level !== 'full';
  return (
    <Suspense
      fallback={
        <div className={cn('space-y-2 py-1', props.className)}>
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-4 w-1/2 rounded" />
        </div>
      }
    >
      <EditorImpl {...props} editable={readOnly ? false : props.editable} />
    </Suspense>
  );
}
