"use client";

import { useState, useTransition } from "react";

import { Button, ErrorNote, Select, Textarea } from "@/components/ui";
import {
  fillTemplate,
  STAGE_LABELS,
  type Stage,
  type TemplateItem,
} from "@/lib/whatsapp-text";

import { loadTemplates, logWhatsappSend, type Template } from "./actions";

/**
 * §5.10. Pick a template, see it filled in, edit it, open WhatsApp.
 *
 * When opened from a call panel the enquiry knows its stage, so the picker
 * opens on the template written for that point in the lead's life rather than
 * whichever happens to sort first. It is only a starting point — every other
 * template stays in the list and the text stays editable.
 */
export function WhatsAppButton({
  enquiryId,
  mobile,
  studentName,
  items,
  term,
  productText,
  counsellorName,
  stage,
  size = "sm",
  onSent,
}: {
  enquiryId: number;
  mobile: string;
  studentName: string | null;
  items: TemplateItem[];
  term: string | null;
  productText?: string | null;
  counsellorName: string | null;
  /** Omit where no single stage is in view. */
  stage?: Stage;
  size?: "sm" | "md";
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  const render = (body: string) =>
    fillTemplate(body, {
      name: studentName,
      items,
      term,
      counsellor: counsellorName,
      productText,
    });

  function openPicker() {
    setError(null);
    setSent(false);
    setOpen(true);
    start(async () => {
      const res = await loadTemplates();
      if (res.error || !res.templates) {
        setError(res.error ?? "Could not load the templates.");
        return;
      }
      setTemplates(res.templates);

      // Exact stage first, then anything marked 'any', then whatever is first.
      const chosen =
        (stage ? res.templates.find((t) => t.stage === stage) : undefined) ??
        res.templates.find((t) => t.stage === "any") ??
        res.templates[0];

      if (chosen) {
        setTemplateId(chosen.id);
        setMessage(render(chosen.body));
      }
    });
  }

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setMessage(render(t.body));
  }

  function send() {
    setError(null);
    start(async () => {
      const res = await logWhatsappSend({
        enquiryId,
        templateId: templateId || null,
        messageText: message,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      // 91 + the stored ten digits: §3 keeps mobiles normalised to exactly that.
      window.open(
        `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}`,
        "_blank",
        "noopener,noreferrer",
      );
      setSent(true);
      onSent?.();
    });
  }

  if (!open) {
    return (
      <Button type="button" size={size} variant="secondary" onClick={openPicker}>
        WhatsApp
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-ok/40 bg-ok-soft/30 px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[230px] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
            Template
          </span>
          <Select
            aria-label="WhatsApp template"
            value={templateId}
            onChange={(e) => chooseTemplate(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.stage && t.stage !== "any" ? ` · ${STAGE_LABELS[t.stage]}` : ""}
              </option>
            ))}
          </Select>
        </label>
        <span className="pb-1.5 text-[11.5px] text-ink-3">
          to +91 {mobile}
          {stage ? ` · ${STAGE_LABELS[stage]} stage` : ""}
        </span>
      </div>

      <label className="mt-2 flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Message
        </span>
        <Textarea
          aria-label="WhatsApp message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          // Enter must not reach the call panel's save handler from in here.
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>

      {error ? (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      {sent ? (
        <p className="mt-2 text-[12px] text-ok" role="status">
          Recorded, and WhatsApp opened in a new tab.
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={pending || !message.trim()}
          onClick={send}
        >
          {pending ? "Opening…" : "Open WhatsApp"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </div>
  );
}
