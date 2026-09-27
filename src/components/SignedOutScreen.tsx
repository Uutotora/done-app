import { ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from './ui/Button';
import './signed-out.css';

/** Only shown after an explicit sign out has finished, never for a lost connection. */
export function SignedOutScreen({
  ru,
  onContinue,
  onDemo,
  busy,
  error,
}: {
  ru: boolean;
  onContinue: () => void;
  onDemo: () => void;
  busy: boolean;
  error: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="signed-out-screen" aria-labelledby="signed-out-title">
      <h1 id="signed-out-title" ref={heading} tabIndex={-1}>
        {ru ? 'Вы вышли из Done' : 'You’re signed out'}
      </h1>
      <p>{ru ? 'Всё останется на своих местах.' : 'Everything will be right where you left it.'}</p>
      <Button className="signed-out-primary" onClick={onContinue} iconRight={<ArrowRight size={16} aria-hidden="true" />}>
        {ru ? 'Войти снова' : 'Sign in again'}
      </Button>
      <button type="button" className="signed-out-demo" disabled={busy} onClick={onDemo}>
        {ru ? 'Посмотреть демо' : 'Explore the demo'}
      </button>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
    </section>
  );
}
