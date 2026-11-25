import { useEffect, useState } from 'react';

export default function ServerStatus() {
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    // The open stream tells the server this tab is still here; it stops after the last tab closes.
    const events = new EventSource('/api/presence');
    events.addEventListener('open', () => setStopped(false));
    events.addEventListener('error', () => setStopped(true));
    return () => events.close();
  }, []);

  return (
    stopped && (
      <p role="alert" className="server-stopped">
        fitools has stopped. Start it again to keep working.
      </p>
    )
  );
}
