import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './states.css';

export type StateArtwork = 'lost' | 'team' | 'quiet' | 'workspace' | 'letter';

/** Decorative: the adjacent heading always carries the meaning of the state. */
export function StateIllustration({ scene, className }: { scene: StateArtwork; className?: string }) {
  return (
    <img
      className={cn('state-illustration', className)}
      src={`/illustrations/states/${scene}.png`}
      width={1536}
      height={1024}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
  );
}

export function StatePanel({
  illustration,
  eyebrow,
  title,
  children,
  action,
  footer,
  className,
  compact = false,
  page = false,
}: {
  illustration: StateArtwork;
  eyebrow?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
  compact?: boolean;
  page?: boolean;
}) {
  const id = useId();
  const Heading = page ? 'h1' : 'h2';
  return (
    <section aria-labelledby={id} className={cn('state-panel', compact && 'state-panel-compact', page && 'state-panel-page', className)}>
      <StateIllustration scene={illustration} />
      {eyebrow && <p className="state-eyebrow">{eyebrow}</p>}
      <Heading id={id} className="state-title">
        {title}
      </Heading>
      {children && <div className="state-description">{children}</div>}
      {action && <div className="state-actions">{action}</div>}
      {footer && <div className="state-footer">{footer}</div>}
    </section>
  );
}
