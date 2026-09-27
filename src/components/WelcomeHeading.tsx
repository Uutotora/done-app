import { VerticalCutReveal } from './ui/vertical-cut-reveal';

/** Quiet, sentence-case typography with a short whole-word entrance. */
export function WelcomeHeading({ ru, reducedMotion }: { ru: boolean; reducedMotion: boolean }) {
  const lines = ru ? ['Большие идеи.', 'Понятные планы.'] : ['Big ideas.', 'Clear plans.'];
  return (
    <div className="auth-heading-block">
      <h1 className="auth-hero-title" aria-label={lines.join(' ')}>
        {lines.map((line, index) => (
          <VerticalCutReveal
            key={`${ru}-${index}`}
            splitBy="words"
            staggerDuration={0.06}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: index * 0.12 }}
            reducedMotion={reducedMotion}
            containerClassName="auth-reveal-line"
            styleWord={(word) => (word === 'планы.' || word === 'plans.' ? 'auth-material auth-material-water' : '')}
          >
            {line}
          </VerticalCutReveal>
        ))}
      </h1>
      <p className="auth-welcome-description">
        {ru ? 'Проекты, задачи и команда — в одном месте.' : 'Projects, tasks, and your team. All in one place.'}
      </p>
    </div>
  );
}
