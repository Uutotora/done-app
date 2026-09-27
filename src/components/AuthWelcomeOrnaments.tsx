import './auth-welcome-ornaments.css';

const FRAME_COUNT = 24;

interface PaperFrame {
  outline: string;
  folds: string;
  shade: string;
  translate: string;
  angle: number;
  dotX: number;
  dotY: number;
}

function makeFrame(index: number, direction: number): PaperFrame {
  const phase = (index / FRAME_COUNT) * Math.PI * 2;
  const fold = (Math.sin(phase) + 1) / 2;
  const x = 32 + fold * 7;
  const y = 40 - fold * 5;
  const innerX = 8 + fold * 4;
  const innerY = 10 - fold * 3;
  const n = (value: number) => Number(value.toFixed(3));
  return {
    outline: `M 0 ${n(-y)} L ${n(innerX)} ${n(-innerY)} L ${n(x)} 0 L ${n(innerX)} ${n(innerY)} L 0 ${n(y)} L ${n(-innerX)} ${n(innerY)} L ${n(-x)} 0 L ${n(-innerX)} ${n(-innerY)} Z`,
    folds: `M 0 ${n(-y)} L 0 0 L ${n(x)} 0 M 0 ${n(y)} L 0 0 L ${n(-x)} 0`,
    shade: `M 0 0 L ${n(x)} 0 L ${n(innerX)} ${n(innerY)} Z M 0 0 L 0 ${n(-y)} L ${n(-innerX)} ${n(-innerY)} Z`,
    translate: `${n(76 + Math.cos(phase) * 2)} ${n(91 + Math.sin(phase) * 5)}`,
    angle: n(direction * (11 + Math.sin(phase) * 9)),
    dotX: n(77 + Math.cos(phase * direction + 0.6) * 56),
    dotY: n(91 + Math.sin(phase * direction + 0.6) * 58),
  };
}

const leftFrames = Array.from({ length: FRAME_COUNT }, (_, index) => makeFrame(index, 1));
const rightFrames = Array.from({ length: FRAME_COUNT }, (_, index) => makeFrame(index, -1));

/** Close the 24-pose cycle with its first pose, then interpolate between poses. */
function loopValues(frames: PaperFrame[], key: keyof PaperFrame): string {
  return [...frames, frames[0]].map((frame) => frame[key]).join(';');
}

function PaperStar({ side }: { side: 'left' | 'right' }) {
  const frames = side === 'left' ? leftFrames : rightFrames;
  const first = frames[0];
  const duration = side === 'left' ? '6s' : '7s';
  const animate = (attributeName: string, key: keyof PaperFrame) => (
    <animate attributeName={attributeName} values={loopValues(frames, key)} dur={duration} repeatCount="indefinite" calcMode="linear" />
  );

  function drawing(animated: boolean) {
    return (
      <g className={animated ? 'auth-paper-motion' : 'auth-paper-still'}>
        <g transform={`translate(${first.translate})`}>
          {animated && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values={loopValues(frames, 'translate')}
              dur={duration}
              repeatCount="indefinite"
              calcMode="linear"
            />
          )}
          <g transform={`rotate(${first.angle})`}>
            {animated && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                values={loopValues(frames, 'angle')}
                dur={duration}
                repeatCount="indefinite"
                calcMode="linear"
              />
            )}
            <path d={first.outline} className="auth-paper-face">
              {animated && animate('d', 'outline')}
            </path>
            <path d={first.shade} className="auth-paper-fold-shade">
              {animated && animate('d', 'shade')}
            </path>
            <path d={first.folds} className="auth-paper-fold-lines">
              {animated && animate('d', 'folds')}
            </path>
          </g>
        </g>
        <circle cx={first.dotX} cy={first.dotY} r="1.8" fill="currentColor">
          {animated && animate('cx', 'dotX')}
          {animated && animate('cy', 'dotY')}
        </circle>
      </g>
    );
  }

  return (
    <svg
      className={`auth-welcome-paper auth-welcome-paper-${side}`}
      viewBox="0 0 156 184"
      fill="none"
      focusable="false"
      data-frame-count={FRAME_COUNT}
    >
      <path d="M 120 33 L 120 43 M 115 38 L 125 38" className="auth-paper-spark" />
      <circle cx="34" cy="139" r="1.2" fill="currentColor" opacity="0.5" />
      <path d="M 106 150 Q 124 146 128 132" className="auth-paper-trail" />
      {drawing(true)}
      {drawing(false)}
    </svg>
  );
}

export function AuthWelcomeOrnaments() {
  return (
    <div className="auth-welcome-ornaments" aria-hidden="true">
      <PaperStar side="left" />
      <PaperStar side="right" />
    </div>
  );
}
