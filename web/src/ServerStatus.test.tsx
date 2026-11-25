import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import ServerStatus from './ServerStatus';

class FakeEventSource extends EventTarget {
  static last: FakeEventSource;
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('holds a presence stream and reports when the server stops', () => {
  vi.stubGlobal('EventSource', FakeEventSource);
  const { unmount } = render(<ServerStatus />);
  const events = FakeEventSource.last;
  expect(events.url).toBe('/api/presence');
  expect(screen.queryByRole('alert')).toBeNull();

  act(() => {
    events.dispatchEvent(new Event('error'));
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'fitools has stopped. Start it again to keep working.',
  );

  act(() => {
    events.dispatchEvent(new Event('open'));
  });
  expect(screen.queryByRole('alert')).toBeNull();

  unmount();
  expect(events.closed).toBe(true);
});
