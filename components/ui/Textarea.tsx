import type { ChangeEvent } from 'react';

// Uses the global .ffr-field / .ffr-label / .ffr-textarea classes defined in
// app/globals.css (ported verbatim from design-source lines 23-26), rather
// than a CSS module, to match the prototype's own textarea styling hook.
export interface TextareaProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
}

export function Textarea({ label, placeholder, value, onChange }: TextareaProps) {
  return (
    <label className="ffr-field">
      <span className="ffr-label">{label}</span>
      <textarea className="ffr-textarea" placeholder={placeholder} value={value} onChange={onChange} />
    </label>
  );
}
