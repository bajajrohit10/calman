import type { ComponentProps, ReactNode } from "react";

/** Shared primitives. Dense by default — this is a tool, not a landing page. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";

const BUTTON_VARIANTS = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line-2 bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger",
} as const;

const BUTTON_SIZES = {
  sm: "h-7 px-2.5",
  md: "h-8 px-3",
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

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cx(
        "h-8 w-full rounded-md border border-line-2 bg-surface px-2.5 text-[13px]",
        "placeholder:text-ink-3 disabled:opacity-60",
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cx(
        "h-8 w-full rounded-md border border-line-2 bg-surface px-2 text-[13px] disabled:opacity-60",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={cx(
        "w-full rounded-md border border-line-2 bg-surface px-2.5 py-1.5 text-[13px] leading-relaxed",
        "placeholder:text-ink-3",
        className,
      )}
    />
  );
}

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
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {label}
      </span>
      {children}
      {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

const BADGE_TONES = {
  neutral: "border-line-2 bg-surface-2 text-ink-2",
  accent: "border-accent/40 bg-accent-soft text-accent",
  ok: "border-ok/40 bg-ok-soft text-ok",
  warn: "border-warn/40 bg-warn-soft text-warn",
  danger: "border-danger/40 bg-danger-soft text-danger",
  info: "border-info/40 bg-info-soft text-info",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium",
        BADGE_TONES[tone],
      )}
    >
      {children}
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
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-[13px] text-ink-2">{description}</p>
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
        <p className="text-[13px] text-ink-2">{note}</p>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
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
