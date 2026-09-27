import { Component, type ReactNode } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { StatePanel } from './StatePanel';
import { Spinner } from './ui/Button';

export function PageLoading() {
  const ru = useLang() === 'ru';
  return (
    <div className="flex min-h-48 flex-1 items-center justify-center gap-2 text-[13px] text-fg-2" role="status">
      <Spinner />
      {ru ? 'Открываем страницу…' : 'Opening your page…'}
    </div>
  );
}

function PageError({ onRetry }: { onRetry: () => void }) {
  const ru = useLang() === 'ru';
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <StatePanel
        page
        illustration="lost"
        eyebrow={ru ? 'Небольшая заминка' : 'A little hiccup'}
        title={ru ? 'Не удалось открыть страницу' : 'This page couldn’t open'}
        action={
          <>
            <button className="state-primary" onClick={onRetry}>
              <RefreshCw size={15} />
              {ru ? 'Попробовать снова' : 'Try again'}
            </button>
            <a className="state-link" href="/">
              {ru ? 'На главную' : 'Go home'}
              <ArrowRight size={15} />
            </a>
          </>
        }
      >
        {ru
          ? 'Попробуйте ещё раз. Если ошибка повторится, обновите страницу или вернитесь на главную.'
          : 'Give it another try. If the problem continues, refresh the page or go back home.'}
      </StatePanel>
    </div>
  );
}

/** Scoped to the current route: navigation remains usable if a view fails. */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <PageError onRetry={() => window.location.reload()} /> : this.props.children;
  }
}
