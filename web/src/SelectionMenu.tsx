import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const presets = {
  thisMonth: 'Select this month',
  lastMonth: 'Select last month',
  all: 'Select all',
  none: 'Clear selection',
};

type Preset = keyof typeof presets;

function selectSessions<T extends { dutyStart: string }>(
  sessions: T[],
  preset: Preset,
  timeZone: string,
) {
  if (preset === 'all') return sessions;
  if (preset === 'none') return [];

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  });
  function monthIndex(date: Date) {
    const parts = formatter.formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return value('year') * 12 + value('month');
  }
  const month = monthIndex(new Date()) - (preset === 'lastMonth' ? 1 : 0);
  return sessions.filter((session) => monthIndex(new Date(session.dutyStart)) === month);
}

export default function SelectionMenu<T extends { dutyStart: string }>({
  sessions,
  timeZone,
  selectedCount,
  onSelect,
}: {
  sessions: T[];
  timeZone: string;
  selectedCount: number;
  onSelect: (sessions: T[]) => void;
}) {
  const [position, setPosition] = useState<{ top: number; left: number; last: boolean } | null>(
    null,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function open(last = false) {
    const bounds = trigger.current!.getBoundingClientRect();
    setPosition({ top: bounds.bottom + 4, left: bounds.left, last });
  }

  function close() {
    setPosition(null);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!position) return;
    const items = menu.current!.querySelectorAll<HTMLButtonElement>('button');
    items[position.last ? items.length - 1 : 0]?.focus();

    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setPosition(null);
    }
    function dismissOnMove() {
      setPosition(null);
    }
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismissOnMove, true);
    window.addEventListener('resize', dismissOnMove);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismissOnMove, true);
      window.removeEventListener('resize', dismissOnMove);
    };
  }, [position]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="selection-trigger"
        aria-label={`Select sessions (${selectedCount} of ${sessions.length} selected)`}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-controls={position ? menuId : undefined}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open(event.key === 'ArrowUp');
          }
        }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          {selectedCount > 0 && (
            <path
              d={selectedCount === sessions.length ? 'm4 8 3 3 5-6' : 'M4 8h8'}
              strokeWidth="2"
            />
          )}
        </svg>
        <svg
          className="selection-caret"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 2v8m-4-4 4 4 4-4" />
        </svg>
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label="Select sessions"
            className="selection-menu"
            style={{ top: position.top, left: position.left }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') event.preventDefault();
                close();
                return;
              }
              const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button'));
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = {
                ArrowDown: (index + 1) % items.length,
                ArrowUp: (index - 1 + items.length) % items.length,
                Home: 0,
                End: items.length - 1,
              }[event.key];
              if (next !== undefined) {
                event.preventDefault();
                items[next]?.focus();
              }
            }}
          >
            {Object.entries(presets).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  onSelect(selectSessions(sessions, preset as Preset, timeZone));
                  close();
                }}
              >
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
