'use client';

// Phase 7c (BYOK AI field polish): the "Polish" button + inline suggestion
// panel rendered next to each of the 7 polishable wizard fields (see
// lib/prompts.ts's POLISH_FIELDS for the complete, locked field list --
// `client` is never one of them, see that registry's own comment). Renders
// `null` entirely (no dead affordance) whenever `useAiKeyStatus()` reports
// anything other than 'configured' -- demo mode, no key saved yet, or the
// status check hasn't resolved yet.
//
// Never touches the draft directly -- `onAccept(next)` is the ONLY way this
// component changes anything, and it's always one of useWizard's existing
// setters (setDraftField/setTouchpointsField/setWinField/updateRisk/
// updateTask/updatePriority), passed in by the calling step. Nothing here
// persists anything -- Save Draft/Publish behave exactly as before.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { IconPolish } from '@/components/ui/icons';
import { useAiKeyStatus } from '@/lib/hooks/useAiKeyStatus';
import { POLISH_FIELDS, type PolishFieldId } from '@/lib/prompts';
import type { PolishContext } from '@/lib/schema/api';
import styles from './PolishButton.module.css';

/** Mirrors PolishRequestSchema's `text` cap (lib/schema/api.ts) -- checked here BEFORE any request leaves the browser. */
const MAX_POLISH_CHARS = 4000;
/** "a module-level cap of 2 concurrent polish calls client-side" -- shared across every PolishButton instance on the page, not per-instance. */
const MAX_CONCURRENT_CLIENT_REQUESTS = 2;
/** Slightly above the server's own 20s Anthropic timeout (lib/server/ai-polish.ts's UPSTREAM_TIMEOUT_MS) -- covers a hang BEFORE the upstream call too (e.g. inside the route handler or the network path to this app itself), which the server's own timeout never bounds. Without this, a hang there leaves `phase='busy'` and the concurrency counter elevated forever, with no client-side recovery. */
const CLIENT_FETCH_TIMEOUT_MS = 25_000;

let activeRequestCount = 0;

type Phase = 'idle' | 'busy' | 'suggested' | 'accepted' | 'error';

export interface PolishButtonProps {
  field: PolishFieldId;
  value: string;
  context?: PolishContext;
  /** Called with the polished text on Accept, and again with the ORIGINAL text on Undo -- always one of useWizard's existing field setters. */
  onAccept: (next: string) => void;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function PolishButton({ field, value, context, onAccept }: PolishButtonProps) {
  const status = useAiKeyStatus();
  const [phase, setPhase] = useState<Phase>('idle');
  const [suggestion, setSuggestion] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // The field's value at the moment Accept was pressed (for Undo) and what
  // Accept just set it to (to detect a further edit) -- see the effect
  // below. `null` when there is nothing to undo.
  const acceptedFromRef = useRef<string | null>(null);
  const acceptedToRef = useRef<string | null>(null);
  // SHOULD-FIX 1 (stale-suggestion race): the exact `value` this button
  // last submitted for polishing -- compared against the LIVE value below
  // to detect an edit that happened while a request was in flight, or
  // after a suggestion arrived but before Accept. `null` when nothing is
  // in flight/pending.
  const submittedTextRef = useRef<string | null>(null);
  // Always holds the CURRENT `value` prop, kept in sync via the effect
  // below -- `handlePolish`'s async continuation closes over the `value`
  // from the render that started it (a stale snapshot equal to what was
  // just submitted, by construction), so it can never observe a LATER
  // edit through that closure alone. This ref is what lets the post-await
  // check in `handlePolish` see the truly-latest value instead.
  const latestValueRef = useRef(value);
  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  // "The snapshot survives until the user edits the field or the panel
  // unmounts" -- if the live `value` (owned by the parent draft) diverges
  // from what Accept itself just wrote, the user typed something further;
  // drop the Undo affordance rather than let it restore a now-stale
  // snapshot over what they just typed.
  useEffect(() => {
    if (phase === 'accepted' && acceptedToRef.current !== null && value !== acceptedToRef.current) {
      setPhase('idle');
      acceptedFromRef.current = null;
      acceptedToRef.current = null;
    }
  }, [value, phase]);

  // SHOULD-FIX 1, symmetric half: mirrors the 'accepted' guard above --
  // once a suggestion is showing, if the user edits the field before
  // clicking Accept, the suggestion is now a rewrite of text that no
  // longer exists here. Discard it silently rather than let it be shown
  // (or applied over the newer edit) a moment longer than it takes this
  // effect to run.
  useEffect(() => {
    if (phase === 'suggested' && submittedTextRef.current !== null && value !== submittedTextRef.current) {
      setPhase('idle');
      setSuggestion('');
      submittedTextRef.current = null;
    }
  }, [value, phase]);

  if (status !== 'configured') return null;

  const trimmed = value.trim();
  const isDisabled = trimmed.length === 0 || phase === 'busy';
  const spec = POLISH_FIELDS[field];

  async function handlePolish() {
    if (trimmed.length === 0) return;
    // NIT 4: the cap check and the request body must agree on what string
    // they're measuring -- both operate on `trimmed` (also what's actually
    // sent, below), so a whitespace-padded value near the boundary can
    // never pass this check and then still get rejected by the server's
    // own raw-length cap (PolishRequestSchema's `text` max, lib/schema/api.ts).
    if (trimmed.length > MAX_POLISH_CHARS) {
      setErrorMessage('This text is too long to polish.');
      setPhase('error');
      return;
    }
    if (activeRequestCount >= MAX_CONCURRENT_CLIENT_REQUESTS) {
      setErrorMessage('Too many polish requests in flight -- try again in a moment.');
      setPhase('error');
      return;
    }

    // Captured now, at the moment this exact text is submitted -- see the
    // two staleness guards above/below for how this is used.
    submittedTextRef.current = value;
    activeRequestCount += 1;
    setPhase('busy');
    try {
      const res = await fetch('/api/ai/polish', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, text: trimmed, context }),
        signal: AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        // The server has already curated this message (lib/server/
        // reports-service.ts's curatedMessage) -- no client-side re-mapping
        // needed.
        setErrorMessage(await readApiError(res, "Couldn't polish this text. Your text is unchanged."));
        setPhase('error');
        return;
      }
      const body = (await res.json()) as { polished: string };
      // SHOULD-FIX 1: the field may have been edited while this request
      // was in flight -- `latestValueRef.current` (kept live via the effect
      // above) reflects that; the `value` closed over by this function does
      // not (it's the same snapshot `submittedTextRef.current` was just set
      // from). If they've diverged, this response is a rewrite of text that
      // no longer exists in the field -- discard it rather than show a
      // suggestion the user can't map back to what they're now looking at
      // (and could otherwise Accept straight over their newer edit).
      if (latestValueRef.current !== submittedTextRef.current) {
        submittedTextRef.current = null;
        setPhase('idle');
        return;
      }
      setSuggestion(body.polished);
      setPhase('suggested');
    } catch {
      setErrorMessage("Couldn't reach the server. Your text is unchanged.");
      setPhase('error');
    } finally {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
    }
  }

  function handleAccept() {
    // Defense in depth alongside the 'suggested'-phase divergence effect
    // above (which should already have discarded this suggestion the
    // moment `value` diverged) -- belt-and-braces against Accept ever
    // applying a rewrite over text newer than what was actually polished.
    if (submittedTextRef.current !== null && value !== submittedTextRef.current) return;
    acceptedFromRef.current = value;
    acceptedToRef.current = suggestion;
    submittedTextRef.current = null;
    onAccept(suggestion);
    setPhase('accepted');
  }

  function handleDiscard() {
    setSuggestion('');
    submittedTextRef.current = null;
    setPhase('idle');
  }

  function handleUndo() {
    if (acceptedFromRef.current !== null) {
      onAccept(acceptedFromRef.current);
    }
    acceptedFromRef.current = null;
    acceptedToRef.current = null;
    setPhase('idle');
  }

  function handleDismissError() {
    setErrorMessage('');
    setPhase('idle');
  }

  return (
    <div className={styles.wrap}>
      <Button
        variant="ghost"
        size="sm"
        disabled={isDisabled}
        aria-busy={phase === 'busy'}
        title={`Polish ${spec.label.toLowerCase()}`}
        onClick={handlePolish}
      >
        <span className={styles.triggerContent}>
          <IconPolish width={14} height={14} className={styles.triggerIcon} />
          {phase === 'busy' ? 'Polishing…' : 'Polish'}
        </span>
      </Button>

      {phase === 'suggested' ? (
        <div className={styles.panel} role="status" aria-live="polite">
          <div className={styles.panelLabel}>Suggested Rewrite</div>
          <p className={styles.suggestionText}>{suggestion}</p>
          <div className={styles.panelActions}>
            <Button variant="dark" size="sm" onClick={handleAccept}>
              Accept
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDiscard}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}

      {phase === 'accepted' ? (
        <div className={styles.panel} role="status" aria-live="polite">
          <div className={styles.panelLabel}>Polished</div>
          <Button variant="ghost" size="sm" onClick={handleUndo}>
            Undo
          </Button>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className={styles.panelError} role="alert">
          <p className={styles.errorText}>{errorMessage}</p>
          <Button variant="ghost" size="sm" onClick={handleDismissError}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
