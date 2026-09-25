import { lazy, Suspense } from 'react';
import { cn } from '@/lib/utils';

export interface EditorProps {
  /** BlockNote document JSON. */
  initial?: unknown[];
  onChange: (blocks: unknown[]) => void;
  placeholder?: string;
  compact?: boolean;
  editable?: boolean;
  className?: string;
}

const EditorImpl = lazy(() => import('./EditorImpl'));

/** Notion-style block editor (BlockNote), loaded on demand to keep the first paint light. */
export function Editor(props: EditorProps) {
  return (
    <Suspense
      fallback={
        <div className={cn('space-y-2 py-1', props.className)}>
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-4 w-1/2 rounded" />
        </div>
      }
    >
      <EditorImpl {...props} />
    </Suspense>
  );
}
