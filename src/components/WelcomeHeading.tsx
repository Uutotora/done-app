import { useEffect, useState } from 'react';

/** Contrasting editorial type; motion never changes the accessible heading. */
export function WelcomeHeading({ ru, reducedMotion }: { ru: boolean; reducedMotion: boolean }) {
  const [phrase, setPhrase] = useState(0);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => setPhrase((value) => (value + 1) % 3), 5200);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);
  const lines = ru
    ? ['Место, где идеи обретают форму.', 'Большие планы начинаются с малого.', 'Хорошо, когда мы вместе.']
    : ['A little space for your next big idea.', 'Big plans begin with small steps.', 'Better things happen together.'];
  return (
    <div className="auth-heading-block">
      <h1 className="auth-hero-title" aria-label={ru ? 'Добро пожаловать в Done' : 'Welcome to Done'}>
        <span>{ru ? 'Добро пожаловать' : 'Welcome'}</span>
        <br />
        <span>{ru ? 'в ' : 'to '}</span>
        <em className="auth-material auth-material-water" data-paused={reducedMotion}>
          Done.
        </em>
      </h1>
      <div className="auth-changing-copy" aria-hidden="true">
        <span key={phrase} data-paused={reducedMotion}>
          {lines[phrase]}
        </span>
      </div>
    </div>
  );
}
