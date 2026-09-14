"use client";

/**
 * The small modal the two Brief 30 actions share.
 *
 * Its own file because the team grid and one counsellor's own day both open
 * one, and a second copy of a dialog is how two dialogs start closing
 * differently.
 */
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/25 px-4 py-14">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[560px] rounded-lg border border-line bg-surface shadow-panel"
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[12px] text-ink-3 hover:text-ink"
          >
            Close
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
