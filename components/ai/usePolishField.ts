'use client';

// Phase 7c (BYOK AI field polish) + the row-alignment layout fix that split
// the old monolithic `PolishButton` into a TRIGGER (an in-field icon
// button, see PolishTrigger.tsx) and a PANEL (the suggestion/error block,
// see PolishPanel.tsx). CSS Grid's `grid-column` only affects DIRECT
// children of a grid container, so a `.taskRow`/`.riskRow`/`.priorityRow`
// row (Step.module.css) needs its suggestion panel to be a direct grid
// sibling of the row's other cells, not nested two levels inside one of
// them -- see Step.module.css's `.fieldWithPolish` comment for the full
// story of the bug this fixes (a taller cell floating above its
// `align-items: end` siblings whenever a suggestion panel was open).
//
// This file is a pure EXTRACTION, not a rewrite: every staleness guard,
// timeout, concurrency cap, and accept/discard/undo/error transition below
// is byte-for-byte the same logic the old `PolishButton.tsx` had. Call this
// hook ONCE per polishable field (never once per PolishTrigger AND once per
// PolishPanel -- that would create two independent state machines racing
// each other) and pass the single returned state object to both.

import { useEffect, useRef, useState } from 'react';
import { useAiKeyStatus, type AiKeyStatusState } from '@/lib/hooks/useAiKeyStatus';
import { POLISH_FIELDS, type PolishFieldId, type PolishFieldSpec } from '@/lib/prompts';
import type { PolishContext } from '@/lib/schema/api';

/** Mirrors PolishRequestSchema's `text` cap (lib/schema/api.ts) -- checked here BEFORE any request leaves the browser. */
const MAX_POLISH_CHARS = 4000;
/** A module-level cap of 2 concurrent polish calls client-side -- shared across every usePolishField instance on the page, not per-instance. */
const MAX_CONCURRENT_CLIENT_REQUESTS = 2;
/** Slightly above the server's own 20s Anthropic timeout (lib/server/ai-polish.ts's UPSTREAM_TIMEOUT_MS) -- covers a hang BEFORE the upstream call too (e.g. inside the route handler or the network path to this app itself), which the server's own timeout never bounds. Without this, a hang there leaves `phase='busy'` and the concurrency counter elevated forever, with no client-side recovery. */
const CLIENT_FETCH_TIMEOUT_MS = 25_000;

let activeRequestCount = 0;

export type PolishPhase = 'idle' | 'busy' | 'suggested' | 'accepted' | 'error';

export interface UsePolishFieldArgs {
  field: PolishFieldId;
  value: string;
  context?: PolishContext;
  /** Called with the polished text on Accept, and again with the ORIGINAL text on Undo -- always one of useWizard's existing field setters. */
  onAccept: (next: string) => void;
}

export interface PolishFieldState {
  /**
   * `'configured'` is the only status a Polish affordance ever renders for
   * -- both `PolishTrigger` and `PolishPanel` return `null` for any other
   * value (demo mode, no key saved yet, or the status check hasn't
   * resolved). Exposed here (rather than each component re-deriving it)
   * so the two can never disagree on whether polish is available.
   */
  status: AiKeyStatusState;
  phase: PolishPhase;
  suggestion: string;
  errorMessage: string;
  isDisabled: boolean;
  spec: PolishFieldSpec;
  trigger: () => void;
  accept: () => void;
  discard: () => void;
  undo: () => void;
  dismissError: () => void;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * The polish state machine for exactly one field. See this file's header
 * comment for the "call once, share the result" contract.
 */
export function usePolishField({ field, value, context, onAccept }: UsePolishFieldArgs): PolishFieldState {
  const status = useAiKeyStatus();
  const [phase, setPhase] = useState<PolishPhase>('idle');
  const [suggestion, setSuggestion] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // The field's value at the moment Accept was pressed (for Undo) and what
  // Accept just set it to (to detect a further edit) -- see the effect
  // below. `null` when there is nothing to undo.
  const acceptedFromRef = useRef<string | null>(null);
  const acceptedToRef = useRef<string | null>(null);
  // SHOULD-FIX 1 (stale-suggestion race): the exact `value` this hook last
  // submitted for polishing -- compared against the LIVE value below to
  // detect an edit that happened while a request was in flight, or after a
  // suggestion arrived but before Accept. `null` when nothing is in
  // flight/pending.
  const submittedTextRef = useRef<string | null>(null);
  // Always holds the CURRENT `value` prop, kept in sync via the effect
  // below -- `handlePolish`'s async continuation closes over the `value`
  // from the render that started it (a stale snapshot equal to what was
  // just submitted, by construction), so it can never observe a LATER edit
  // through that closure alone. This ref is what lets the post-await check
  // in `handlePolish` see the truly-latest value instead.
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

  return {
    status,
    phase,
    suggestion,
    errorMessage,
    isDisabled,
    spec,
    trigger: handlePolish,
    accept: handleAccept,
    discard: handleDiscard,
    undo: handleUndo,
    dismissError: handleDismissError,
  };
}
