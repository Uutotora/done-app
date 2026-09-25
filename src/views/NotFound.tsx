import { Link } from 'react-router';
import { useT } from '@/lib/i18n';
import { Topbar } from '@/components/Topbar';
import { EmptyState } from '@/components/ui/bits';
import { Button } from '@/components/ui/Button';

export function NotFound() {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar crumbs={[{ label: t('misc.notFound') }]} />
      <EmptyState
        icon="🧭"
        title={t('misc.notFound')}
        action={
          <Link to="/">
            <Button variant="secondary">{t('misc.goHome')}</Button>
          </Link>
        }
      />
    </div>
  );
}
