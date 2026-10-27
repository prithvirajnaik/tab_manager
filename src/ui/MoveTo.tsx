import { useState } from 'preact/hooks';
import type { TopicRef } from './TabsPanel';

type Props = {
  label: string;
  topics: TopicRef[];
  busy: boolean;
  onMove: (toTopicId: string) => void;
};

/**
 * Choosing a topic does nothing by itself; the Move button acts. Arrow keys on a closed
 * select change its value in Chromium, so a select must never act on change.
 */
export function MoveTo({ label, topics, busy, onMove }: Props) {
  const [target, setTarget] = useState('');
  return (
    <span class="move">
      <select
        class="tab__move"
        aria-label={`Topic to move ${label} to`}
        disabled={busy}
        value={target}
        onChange={(e) => setTarget(e.currentTarget.value)}
      >
        <option value="">Move to…</option>
        {topics.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {target && (
        <button
          type="button"
          class="btn btn--small"
          disabled={busy}
          aria-label={`Move ${label}`}
          onClick={() => {
            onMove(target);
            setTarget('');
          }}
        >
          Move
        </button>
      )}
    </span>
  );
}
