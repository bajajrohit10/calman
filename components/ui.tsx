import type { ComponentProps, ReactNode } from "react";

/** Shared primitives. Dense by default — this is a tool, not a landing page. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/**
 * The card every panel, filter bar and table sits in.
 *
 * A one-pixel border alone left cards floating on the ground with nothing to
 * say which was on top; the shadow is two hairlines rather than a drop, so it
 * reads as a lift and not as a card game.
 */
export const CARD = "rounded-lg border border-line bg-surface shadow-card";

/**
 * The header row of a data table.
 *
 * Small, uppercase and letter-spaced: column names are landmarks to skim past,
 * not content to read, so they give up size in exchange for the row of data
 * being the largest text in the table.
 */
export const TABLE_HEAD_ROW =
  "border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";

/** A cell. 5px of vertical padding buys roughly a row a screen over 6px. */
export const CELL = "px-2 py-[5px]";

/** The accent border + ring a filter wears once it is actually filtering. */
export const FILLED = "border-accent ring-2 ring-accent-soft";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";

const BUTTON_VARIANTS = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line-2 bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger",
} as const;

const BUTTON_SIZES = {
  sm: "h-[26px] px-2.5",
  md: "h-7 px-[11px]",
} as const;

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <button
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
    />
  );
}

const CONTROL =
  "h-[30px] w-full rounded-md border border-line-2 bg-surface text-[12.5px] disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cx(CONTROL, "px-2 placeholder:text-ink-3", className)}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select {...props} className={cx(CONTROL, "px-1.5", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={cx(
        "w-full rounded-md border border-line-2 bg-surface px-2 py-1.5 text-[12.5px] leading-relaxed",
        "placeholder:text-ink-3",
        className,
      )}
    />
  );
}

/** The label above a control, everywhere. */
export const FIELD_LABEL =
  "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className={FIELD_LABEL}>{label}</span>
      {children}
      {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

const BADGE_TONES = {
  neutral: "border-line-2 bg-surface-2 text-ink-2",
  accent: "border-accent/35 bg-accent-soft text-accent",
  ok: "border-ok/35 bg-ok-soft text-ok",
  warn: "border-warn/35 bg-warn-soft text-warn",
  danger: "border-danger/35 bg-danger-soft text-danger",
  info: "border-info/35 bg-info-soft text-info",
} as const;

/**
 * A status pill.
 *
 * Fill, text colour and border all move together, so the difference between
 * "Follow-up" and "Call back" survives being printed, screenshotted, or read
 * by somebody who does not separate blue from amber. `dot` adds a filled
 * circle for the pills that name a stage, which is what lets the eye group a
 * column of them without reading any of the words.
 */
export function Badge({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[17px] items-center gap-1 rounded border px-1.5 text-[10.5px] font-semibold",
        BADGE_TONES[tone],
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-current opacity-75"
        />
      ) : null}
      {children}
    </span>
  );
}

const IMPORTANCE_TONES: Record<string, string> = {
  A: "bg-accent text-accent-ink",
  B: "bg-accent-soft text-accent",
  C: "bg-surface-2 text-ink-2",
  D: "bg-surface-2 text-ink-3",
};

/**
 * The importance grade, as a square rather than a pill.
 *
 * It is one character in a narrow column next to several pills; a different
 * shape is what stops the two reading as the same kind of thing, and the fill
 * stepping down from solid accent to flat grey gives the column an order you
 * can see without reading the letters.
 */
export function ImportanceMark({ grade }: { grade: string }) {
  const key = grade.trim().toUpperCase().slice(0, 1);
  return (
    <span
      className={cx(
        "inline-flex size-[17px] items-center justify-center rounded text-[10.5px] font-bold",
        IMPORTANCE_TONES[key] ?? IMPORTANCE_TONES.D,
      )}
    >
      {key || "—"}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line pb-3">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-ink-2">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Phase 1 placeholder, so an empty route still says what it will become. */
export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} />
      <div className="rounded-lg border border-dashed border-line-2 bg-surface/50 px-5 py-8">
        <p className="text-[12.5px] text-ink-2">{note}</p>
        <p className="mt-1.5 text-[12px] text-ink-3">
          Not built yet — this route exists so the shell and its permissions can be
          tested.
        </p>
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/40 bg-danger-soft px-2.5 py-1.5 text-[12.5px] text-danger"
    >
      {children}
    </p>
  );
}
