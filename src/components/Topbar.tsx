import { ChevronsRight, Menu, Moon, Star, Sun } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useUI, showSidebarPeek, hideSidebarPeek } from '@/lib/ui';
import { presenceScope, usePresence } from '@/lib/presence';
import { useData } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { useIsDark, useMediaQuery } from '@/lib/hooks';
import type { Ref } from '@/lib/types';
import { cn, modKey } from '@/lib/utils';
import { IconButton } from './ui/Button';
import { Avatar, PageIcon } from './ui/bits';
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
          <IconButton
            size="md"
            onClick={() => {
              useUI.setState({ sidebarPeek: false });
              if (mobile) setMobileOpen(true);
              else setPrefs({ sidebarCollapsed: false });
            }}
            onPointerEnter={() => !mobile && showSidebarPeek(120)}
            onPointerLeave={() => !mobile && hideSidebarPeek(360)}
            label={t('nav.expand')}
            className="group/menu relative"
          >
            {/* Like Notion: the menu icon turns into "open" arrows under the pointer. */}
            <Menu size={18} className="absolute transition-[opacity,transform,translate,scale,rotate] duration-150 group-hover/menu:scale-75 group-hover/menu:opacity-0" />
            <ChevronsRight size={18} className="absolute -translate-x-1 opacity-0 transition-[opacity,transform,translate,scale,rotate] duration-150 group-hover/menu:translate-x-0 group-hover/menu:opacity-100" />
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
        <PresenceHere />
        {actions}
        {favorite && (
          <Tooltip content={isFav ? t('common.removeFromFavorites') : t('common.addToFavorites')}>
            <IconButton
              size="md"
              onClick={() => toggleFavorite(favorite)}
              label={isFav ? t('common.removeFromFavorites') : t('common.addToFavorites')}
            >
              <Star size={17} className={cn('transition-[color,transform,translate,scale,rotate]', isFav && 'scale-110 fill-[#f5c518] text-[#f5c518]')} />
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

/** Avatars of teammates who have the same project, page or task open. */
function PresenceHere() {
  const t = useT();
  const location = useLocation();
  const peers = usePresence((s) => s.peers);
  const meId = useData((s) => s.meId);
  const people = useData((s) => s.people);
  const scope = presenceScope(location.pathname);
  const here = peers.filter((p) => p.id !== meId && p.path && presenceScope(p.path) === scope);
  return (
    <div className="mr-1 flex items-center">
      <AnimatePresence initial={false}>
        {here.slice(0, 4).map((p, i) => (
          <motion.span
            key={p.id}
            layout
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn('relative', i && '-ml-1.5')}
          >
            <Tooltip content={t('presence.viewing', { name: p.name })}>
              <span className="block rounded-full transition-transform duration-150 hover:z-10 hover:-translate-y-0.5">
                <Avatar person={people[p.id] ?? { id: p.id, name: p.name, color: 'gray' }} size={24} ring />
              </span>
            </Tooltip>
          </motion.span>
        ))}
      </AnimatePresence>
      {here.length > 4 && <span className="ml-1 text-[12px] text-fg-3">+{here.length - 4}</span>}
    </div>
  );
}
