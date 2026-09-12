"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";

/**
 * A link to a student's history that fetches the page when you look at it
 * (§27.3).
 *
 * /students/[mobile] is a dynamic route with no loading.js, so Next's default
 * prefetch ("auto") fetches the partial route down to the nearest loading
 * boundary — which here is nothing at all, leaving the whole round trip on the
 * click. Measured warm on production at 335–837ms.
 *
 * prefetch={true} would fix that and cost too much: it fires when the link
 * enters the viewport, and these sit in lists fifty rows long, so scrolling
 * the desk would request fifty student pages nobody asked for. Hovering is the
 * signal that somebody means it — router.prefetch() on pointer entry, once per
 * link, and the click lands on a warm cache.
 */
export function StudentLink({
  mobile,
  className,
  onClick,
  children,
}: {
  mobile: string;
  className?: string;
  /** Rows that open a panel stop the click from reaching the row itself. */
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const done = useRef(false);

  const warm = () => {
    if (done.current) return;
    done.current = true;
    router.prefetch(`/students/${mobile}`);
  };

  return (
    <Link
      href={`/students/${mobile}`}
      prefetch={false}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onClick={onClick}
      className={className}
    >
      {children}
    </Link>
  );
}
