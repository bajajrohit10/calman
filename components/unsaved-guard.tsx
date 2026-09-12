"use client";

import { useEffect } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";

/**
 * "You have unsaved details — Save, Discard, or Stay?" (§27.4)
 *
 * Typed content is the most expensive thing in the product: it is the only
 * part nobody can reconstruct. A half-written note lost to a mis-click is a
 * call the counsellor has to make again, and they will not.
 *
 * Two escapes have to be covered and they are nothing alike. Leaving the tab
 * is the browser's to refuse, and it only offers its own wording via
 * beforeunload — no custom text, no Save button, that is the platform. Moving
 * inside the app is ours, and there we can do the useful thing: offer to save
 * first. So the same registration drives both, and only the in-app half gets
 * the three-way choice.
 *
 * A form registers a claim: whether it is dirty, and how to save. Anything
 * that navigates asks first.
 */
export type UnsavedClaim = {
  /** Is there typed content that would be lost? */
  isDirty: () => boolean;
  /** Perform the form's normal save. Resolves false if the save was refused. */
  save: () => Promise<boolean>;
  /** Throw the typed content away, so a later check reports clean. */
  discard: () => void;
};

type Ctx = {
  register: (claim: UnsavedClaim | null) => void;
  /**
   * Ask permission to leave. Resolves true when the caller may proceed —
   * either because nothing was typed, or because the counsellor saved or
   * discarded it.
   */
  confirmLeave: () => Promise<boolean>;
};

const UnsavedContext = createContext<Ctx | null>(null);

export function UnsavedProvider({ children }: { children: React.ReactNode }) {
  const claim = useRef<UnsavedClaim | null>(null);
  const [asking, setAsking] = useState<((ok: boolean) => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const register = useCallback((next: UnsavedClaim | null) => {
    claim.current = next;
  }, []);

  const confirmLeave = useCallback(() => {
    if (!claim.current?.isDirty()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setAsking(() => resolve));
  }, []);

  // The tab-close half. Registered once and kept in step with the claim, so a
  // clean form does not leave a stray handler making the browser ask about
  // nothing.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!claim.current?.isDirty()) return;
      e.preventDefault();
      // Chrome requires returnValue set; the text itself is the browser's.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const value = useMemo(() => ({ register, confirmLeave }), [register, confirmLeave]);

  const settle = async (choice: "save" | "discard" | "stay") => {
    const resolve = asking;
    if (!resolve) return;
    if (choice === "stay") {
      setAsking(null);
      resolve(false);
      return;
    }
    if (choice === "discard") {
      claim.current?.discard();
      setAsking(null);
      resolve(true);
      return;
    }
    setBusy(true);
    const ok = (await claim.current?.save()) ?? false;
    setBusy(false);
    setAsking(null);
    // A refused save keeps them where they are, with the error the form
    // rendered and their typing intact — leaving would throw away the thing
    // they just tried to keep.
    resolve(ok);
  };

  return (
    <UnsavedContext.Provider value={value}>
      {children}
      {asking ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Unsaved details"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
        >
          <div className="w-full max-w-[420px] rounded-lg border border-line bg-surface p-4 shadow-panel">
            <h2 className="text-[14px] font-semibold text-ink">
              You have unsaved details
            </h2>
            <p className="mt-1 text-[12.5px] text-ink-2">
              Save them, throw them away, or stay on this call.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={() => settle("save")}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => settle("discard")}>
                Discard
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => settle("stay")}>
                Stay
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </UnsavedContext.Provider>
  );
}

/** For the forms: register a claim for as long as this component is mounted. */
export function useUnsavedClaim(claim: UnsavedClaim | null) {
  const ctx = useContext(UnsavedContext);
  const latest = useRef(claim);
  // After every render, not during one: the claim closes over the form's
  // state, and a ref written in render is a ref React is entitled to discard.
  useEffect(() => {
    latest.current = claim;
  });

  useEffect(() => {
    if (!ctx) return;
    // Read through a ref, so the claim always answers with the form's current
    // state rather than whatever it held when the effect last ran.
    ctx.register({
      isDirty: () => latest.current?.isDirty() ?? false,
      save: async () => (await latest.current?.save()) ?? false,
      discard: () => latest.current?.discard(),
    });
    return () => ctx.register(null);
  }, [ctx]);
}

/** For anything that navigates: `if (await confirmLeave()) router.push(...)`. */
export function useConfirmLeave() {
  const ctx = useContext(UnsavedContext);
  return ctx?.confirmLeave ?? (() => Promise.resolve(true));
}
