import { VerticalCutReveal } from './ui/vertical-cut-reveal';

/** One accessible greeting, with staggered letter reveals like the supplied reference. */
export function WelcomeHeading({ ru, reducedMotion }: { ru: boolean; reducedMotion: boolean }) {
  const lines = ru ? ['ДОБРО 👋', 'ПОЖАЛОВАТЬ', '🌤️ В DONE 😊'] : ['WELCOME 👋', '🌤️ TO DONE', 'NICE TO MEET YOU 😊'];
  return (
    <div className="auth-heading-block">
      <h1 className="auth-hero-title" aria-label={ru ? 'Добро пожаловать в Done' : 'Welcome to Done'}>
        {lines.map((line, index) => (
          <VerticalCutReveal
            key={`${ru}-${index}`}
            splitBy="characters"
            staggerDuration={0.025}
            staggerFrom={index === 0 ? 'first' : index === 1 ? 'last' : 'center'}
            reverse={index === 1}
            transition={{ type: 'spring', stiffness: 200, damping: 21, delay: index * 0.38 }}
            reducedMotion={reducedMotion}
            containerClassName="auth-reveal-line"
            styleWord={(word) => (word === 'DONE' ? 'auth-material auth-material-water' : '')}
          >
            {line}
          </VerticalCutReveal>
        ))}
      </h1>
    </div>
  );
}
