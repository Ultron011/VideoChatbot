type Props = {
  connected: boolean;
  visible: boolean;
};

export function StatusPill({ connected, visible }: Props) {
  if (!visible) return null;
  return (
    <div className={`status-pill ${connected ? 'good' : 'connecting'}`}>
      <span className="status-dot" />
      <span>{connected ? 'Connected' : 'Connecting…'}</span>
    </div>
  );
}
