import { useId, useRef, useState } from 'react';

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
  const [isOpen, setIsOpen] = useState(false);
  const trigger = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const wasOpenOnPointerDown = useRef(false);
  const menuId = useId();
  const isPartiallySelected = selectedCount > 0 && selectedCount < sessions.length;

  function open(last = false) {
    menu.current!.showPopover({ source: trigger.current! });
    const items = menu.current!.querySelectorAll<HTMLButtonElement>('button');
    items[last ? items.length - 1 : 0]?.focus();
  }

  function close() {
    menu.current!.hidePopover();
    trigger.current?.focus();
  }

  function toggle() {
    if (menu.current!.matches(':popover-open')) close();
    else open();
  }

  return (
    <>
      <input
        ref={(input) => {
          trigger.current = input;
          if (input) input.indeterminate = isPartiallySelected;
        }}
        type="checkbox"
        checked={selectedCount === sessions.length}
        aria-label={`Select sessions (${selectedCount} of ${sessions.length} selected)`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onPointerDown={() => {
          wasOpenOnPointerDown.current = menu.current!.matches(':popover-open');
        }}
        onChange={(event) => {
          event.currentTarget.indeterminate = isPartiallySelected;
          // Native light dismissal closes the popover before a checkbox click completes.
          if (wasOpenOnPointerDown.current) close();
          else toggle();
          wasOpenOnPointerDown.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            toggle();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open(event.key === 'ArrowUp');
          }
        }}
      />
      <div
        ref={menu}
        id={menuId}
        role="menu"
        aria-label="Select sessions"
        className="selection-menu"
        popover="auto"
        onBeforeToggle={(event) => setIsOpen(event.newState === 'open')}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
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
      </div>
    </>
  );
}
