import { useEffect, useRef, useState } from 'react';
import type { SessionView } from './sessions';

export default function DeleteSessionsForm({
  id,
  open,
  selectedSessionIds,
  onClose,
  onDeleted,
  onDeletingChange,
}: {
  id: string;
  open: boolean;
  selectedSessionIds: ReadonlySet<string>;
  onClose: () => void;
  onDeleted: (view: SessionView) => void;
  onDeletingChange: (deleting: boolean) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const cancelButton = useRef<HTMLButtonElement>(null);
  const selectedCount = selectedSessionIds.size;
  const hasSelection = selectedCount > 0;

  useEffect(() => {
    // Start on Cancel so pressing Enter right away cannot delete anything.
    if (open) cancelButton.current?.focus();
  }, [open]);

  async function deleteSessions() {
    if (deleting || !hasSelection) return;
    setDeleting(true);
    onDeletingChange(true);
    setError('');
    try {
      const response = await fetch('/api/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: [...selectedSessionIds] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not delete sessions.');
      onDeleted(body);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not delete sessions.');
    } finally {
      setDeleting(false);
      onDeletingChange(false);
    }
  }

  if (!open) {
    if (error) setError('');
    return null;
  }

  return (
    <form
      id={id}
      className="document-form"
      data-kind="delete"
      aria-label="Delete sessions"
      aria-busy={deleting}
      onSubmit={(event) => {
        event.preventDefault();
        void deleteSessions();
      }}
    >
      <fieldset disabled={deleting}>
        <div className="document-form-footer">
          <p id={`${id}-scope`} className="document-scope">
            Delete {selectedCount} selected {selectedCount === 1 ? 'session' : 'sessions'}? This
            cannot be undone.
          </p>
          <div className="document-form-actions">
            <button
              ref={cancelButton}
              type="button"
              className="action-button text"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="action-button danger"
              aria-describedby={`${id}-scope`}
              disabled={!hasSelection || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
