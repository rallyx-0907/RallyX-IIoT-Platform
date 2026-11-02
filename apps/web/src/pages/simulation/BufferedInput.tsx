import { useEffect, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

/** Numeric drafts may be empty or negative while typing; commit on blur/Enter. */
export function BufferedInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [draft, setDraft] = useState(String(props.value ?? ''));
  useEffect(() => setDraft(String(props.value ?? '')), [props.value]);
  if (props.type !== 'number') return <input {...props} />;
  const commit = () => {
    setDraft(String(props.value ?? ''));
    if (!draft.trim() || !Number.isFinite(Number(draft))) return;
    props.onChange?.({ target: { value: draft } } as React.ChangeEvent<HTMLInputElement>);
  };
  return <input {...props} type="text" inputMode="decimal" value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />;
}
