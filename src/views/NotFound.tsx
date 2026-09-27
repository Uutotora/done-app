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
          eyebrow={ru ? '404 · Немного сбились с пути' : '404 · A little off track'}
          title={t('misc.notFound')}
          action={
            <>
              <Link to="/" className="state-primary">
                {t('misc.goHome')} <ArrowRight size={15} />
              </Link>
              <button type="button" className="state-link" onClick={() => useUI.getState().setPalette(true)}>
                <Search size={15} />
                {ru ? 'Найти в пространстве' : 'Search workspace'}
              </button>
            </>
          }
          footer={
            ru
              ? 'Ожидали увидеть здесь проект? Уточните у его владельца, есть ли у вас доступ.'
              : 'Expecting a project here? Check with its owner that you have access.'
          }
        >
          {ru
            ? 'Возможно, страница переехала, была удалена или ссылка оказалась с опечаткой. Давайте вернёмся к вашим планам.'
            : 'This page may have moved, been deleted, or the link has a typo. Let’s get you back to your plans.'}
        </StatePanel>
      </div>
    </div>
  );
}
