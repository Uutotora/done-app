import './auth-welcome-ornaments.css';

/** Two original ink flipbooks. Each atlas contains 24 separately drawn frames. */
export function AuthWelcomeOrnaments() {
  return (
    <div className="auth-welcome-ornaments" aria-hidden="true">
      <div className="auth-welcome-object auth-welcome-notebook">
        <div className="auth-welcome-frame" data-frame-count={24} />
      </div>
      <div className="auth-welcome-object auth-welcome-pencil">
        <div className="auth-welcome-frame" data-frame-count={24} />
      </div>
    </div>
  );
}
