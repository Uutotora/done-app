import { Link } from 'react-router';
import { ArrowRight, Search } from 'lucide-react';
import { useLang, useT } from '@/lib/i18n';
import { Topbar } from '@/components/Topbar';
import { StatePanel } from '@/components/StatePanel';
import { useUI } from '@/lib/ui';

export function NotFound() {
  const t = useT();
  const ru = useLang() === 'ru';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar crumbs={[{ label: t('misc.notFound') }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StatePanel
          page
          illustration="lost"
          eyebrow="404"
          title={t('misc.notFound')}
          action={
            <>
              <Link to="/" className="state-primary">
                {t('misc.goHome')} <ArrowRight size={15} />
              </Link>
              <button type="button" className="state-link" onClick={() => useUI.getState().setPalette(true)}>
                <Search size={15} />
                {ru ? 'Поиск' : 'Search'}
              </button>
            </>
          }
        >
          {ru ? 'Её переместили, удалили, или у вас пока нет доступа.' : 'It was moved, deleted, or you don’t have access yet.'}
        </StatePanel>
      </div>
    </div>
  );
}
