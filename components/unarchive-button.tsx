"use client";

import { useState, useTransition } from "react";

import { unarchiveEnquiry } from "@/app/(app)/settings/data/actions";
import { Button, ErrorNote } from "@/components/ui";

/**
 * §9: put one archived enquiry back into the working lists.
 *
 * Only rendered for an admin. The action checks the role again — the button
 * not being drawn is not a permission.
 */
export function UnarchiveButton({
  enquiryId,
  onDone,
}: {
  enquiryId: number;
  onDone?: () => void;
}) {
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await unarchiveEnquiry(enquiryId);
            setResult(res);
            if (!res.error) onDone?.();
          })
        }
      >
        {pending ? "Unarchiving…" : "Unarchive"}
      </Button>
      {result?.ok ? (
        <span className="text-[11.5px] text-ok" role="status">
          {result.ok} Reload to see it back in the lists.
        </span>
      ) : null}
      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
    </span>
  );
}
