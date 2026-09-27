import './auth-stationery.css';

/** Quiet ink illustrations around the form; the entire layer is decorative. */
export function AuthStationery() {
  return (
    <div className="auth-stationery" aria-hidden="true">
      <span className="auth-stationery-object auth-stationery-notebook" />
      <span className="auth-stationery-object auth-stationery-plane" />
      <span className="auth-stationery-object auth-stationery-notes" />
      <span className="auth-stationery-object auth-stationery-clip" />
    </div>
  );
}
