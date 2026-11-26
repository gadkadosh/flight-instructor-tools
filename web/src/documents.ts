import { useState } from 'react';
import { request } from './request';

export type DocumentDownload = ReturnType<typeof useDocumentDownload>;

export function useDocumentDownload() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  /** Resolves to whether the file was handed to the browser. */
  async function download(endpoint: string, body: unknown, name: string) {
    if (generating) return false;
    setGenerating(true);
    setError('');
    try {
      const response = await request(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        `Could not generate ${name}.`,
      );
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      // The server names the file; an empty name lets the browser choose.
      link.download = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? '';
      document.body.append(link);
      link.click();
      link.remove();
      // Give the browser time to start reading the blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : `Could not generate ${name}.`);
      return false;
    } finally {
      setGenerating(false);
    }
  }

  return { generating, error, download, clearError: () => setError('') };
}
