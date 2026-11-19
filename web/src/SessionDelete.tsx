import { useEffect, useId, useRef, useState } from 'react';
import type { SessionView } from './sessions';

export default function SessionDelete({
  sessionId,
  etag,
  description,
  onCancel,
  onDeleted,
}: {
  sessionId: string;
  etag: string;
  description: string;
  onCancel: () => void;
  onDeleted: (view: SessionView) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
    cancelButton.current?.focus();
  }, []);

  function cancel() {
    dialog.current?.close();
    onCancel();
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { 'If-Match': etag },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not delete session.');
      dialog.current?.close();
      onDeleted(body);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not delete session.');
      setDeleting(false);
    }
  }

  return (
    <dialog
      className="delete-dialog"
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-session ${id}-effect`}
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) cancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void remove();
        }}
      >
        <h2 id={`${id}-title`}>Delete session?</h2>
        <p id={`${id}-session`} className="delete-subject">
          {description}
        </p>
        <p id={`${id}-effect`}>
          This permanently removes the session from your records. Future invoices and duty reports
          will use the updated records.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="delete-actions">
          <button
            ref={cancelButton}
            type="button"
            className="action-button secondary"
            onClick={cancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button type="submit" className="action-button danger" disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete session'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
