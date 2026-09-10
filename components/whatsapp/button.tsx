"use client";

import { useState, useTransition } from "react";

import { Button, ErrorNote, Select, Textarea } from "@/components/ui";

import { loadTemplates, logWhatsappSend, type Template } from "./actions";

function fill(body: string, name: string | null, course: string): string {
  // Blank-safe, and the substitutions have to fit the words already around
  // them. The seeded templates say "about your {course} enquiry", so a
  // {course} fallback of "your enquiry" produced "about your your enquiry
  // enquiry". A bare noun is the only thing that reads in every slot — and
  // when there is genuinely nothing to say, the counsellor is looking at an
  // editable preview and can fix it.
  return body
    .replaceAll("{name}", (name ?? "").trim() || "there")
    .replaceAll("{course}", course.trim() || "course");
}

export function WhatsAppButton({
  enquiryId,
  mobile,
  studentName,
  courseText,
  size = "sm",
  onSent,
}: {
  enquiryId: number;
  mobile: string;
  studentName: string | null;
  courseText: string;
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
      const first = res.templates[0];
      if (first) {
        setTemplateId(first.id);
        setMessage(fill(first.body, studentName, courseText));
      }
    });
  }

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setMessage(fill(t.body, studentName, courseText));
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
        <label className="flex min-w-[190px] flex-col gap-1">
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
              </option>
            ))}
          </Select>
        </label>
        <span className="pb-1.5 text-[11.5px] text-ink-3">to +91 {mobile}</span>
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
