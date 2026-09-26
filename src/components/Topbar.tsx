import { ChevronsRight, Moon, Star, Sun } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useUI } from '@/lib/ui';
import { useData } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { useIsDark, useMediaQuery } from '@/lib/hooks';
import type { Ref } from '@/lib/types';
import { cn, modKey } from '@/lib/utils';
import { IconButton } from './ui/Button';
import { PageIcon } from './ui/bits';
import { Tooltip } from './ui/Overlay';

export interface Crumb {
  label: string;
  icon?: string;
  to?: string;
}

export function Topbar({ crumbs, actions, favorite, className }: { crumbs: Crumb[]; actions?: ReactNode; favorite?: Ref; className?: string }) {
  const t = useT();
  const mobile = useMediaQuery('(max-width: 767px)');
  const setMobileOpen = useUI((s) => s.setMobileSidebar);
  const collapsed = useData((s) => s.prefs.sidebarCollapsed);
  const setPrefs = useData((s) => s.setPrefs);
  const isDark = useIsDark();
  const isFav = useData((s) => !!favorite && s.prefs.favorites.some((f) => f.kind === favorite.kind && f.id === favorite.id));
  const toggleFavorite = useData((s) => s.toggleFavorite);

  return (
    <header className={cn('sticky top-0 z-10 flex h-11 shrink-0 items-center gap-1 bg-bg/90 px-3 backdrop-blur-md', className)}>
      {(collapsed || mobile) && (
        <Tooltip content={t('nav.expand')} shortcut={`${modKey()} \\`}>
          <IconButton size="md" onClick={() => (mobile ? setMobileOpen(true) : setPrefs({ sidebarCollapsed: false }))} label={t('nav.expand')}>
            <ChevronsRight size={18} />
          </IconButton>
        </Tooltip>
      )}
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 text-[14px]">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="px-0.5 text-fg-4">/</span>}
            {c.to ? (
              <Link to={c.to} className="flex min-w-0 items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-fg-2 hover:bg-hover">
                {c.icon && <PageIcon icon={c.icon} size={16} />}
                <span className="truncate">{c.label}</span>
              </Link>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 truncate px-1.5 py-0.5 text-fg">
                {c.icon && <PageIcon icon={c.icon} size={16} />}
                <span className="truncate">{c.label}</span>
              </span>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="flex items-center gap-1">
        {actions}
        {favorite && (
          <Tooltip content={isFav ? t('common.removeFromFavorites') : t('common.addToFavorites')}>
            <IconButton
              size="md"
              onClick={() => toggleFavorite(favorite)}
              label={isFav ? t('common.removeFromFavorites') : t('common.addToFavorites')}
            >
              <Star size={17} className={cn('transition-[color,transform]', isFav && 'scale-110 fill-[#f5c518] text-[#f5c518]')} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content={t('cmd.toggleTheme')} shortcut={`${modKey()}⇧L`}>
          <IconButton size="md" onClick={() => setPrefs({ theme: isDark ? 'light' : 'dark' })} label={t('cmd.toggleTheme')}>
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}
