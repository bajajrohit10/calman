-- Which point in a lead's life a WhatsApp template is written for.
--
-- The message you send someone you have never spoken to is not the message you
-- send on the third chase, and picking the right one from a growing list every
-- time is exactly the sort of small friction that gets skipped at 200 calls a
-- day. The stage lets the picker open on the right template; the counsellor
-- can still choose any other, and the text stays editable either way.
--
-- 'any' is the default and the fallback: a template with no particular stage
-- in mind suits all of them.

create type public.template_stage as enum (
  'fresh',
  'followup_1',
  'followup_2',
  'followup_3',
  'after_sale',
  'any'
);

alter table public.whatsapp_templates
  add column if not exists stage public.template_stage not null default 'any';

comment on column public.whatsapp_templates.stage is
  'Where in the lead''s life this template belongs. Derived at send time from '
  'follow_up_slots_used (0 = fresh, 1-3 = the matching follow-up) or from the '
  'enquiry type for after_sale; ''any'' is the fallback.';

-- The three seeded templates map onto the stages they were written for.
update public.whatsapp_templates set stage = 'fresh'      where name = 'Intro';
update public.whatsapp_templates set stage = 'followup_1' where name = 'Follow-up';
update public.whatsapp_templates set stage = 'any'        where name = 'Offer reminder';
