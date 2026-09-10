-- Calman — master list seed.
--
-- Built from docs/reference/Feb 26 - Zeroinfy Calman Calling.xlsx (Data tab for
-- courses and subjects; New Calls and Follow Up Sheets for the distinct Source
-- and Teacher Name values, comma-split and de-duplicated case-insensitively),
-- with Rohit's corrections of 10 Sep 2026 applied. The spreadsheet itself is
-- never committed — docs/reference/ is git-ignored.
--
-- Idempotent: every insert is ON CONFLICT DO NOTHING against a unique name, so
-- this runs on `supabase db reset` and against the hosted project alike.
--
-- Counts: 7 sources · 73 teachers · 7 courses · 24 subjects · 5 contents
--         13 terms · 3 WhatsApp templates · 0 holidays

-- ---------------------------------------------------------------------------
-- Retire the placeholder spellings from the first seed
--
-- Written before the spreadsheet existed, and they differ from the sheet's own
-- spelling. Renamed in place so the id survives and no near-duplicate pair is
-- left behind. No-ops on a fresh database.
-- ---------------------------------------------------------------------------

update public.sources set name = 'AC'
 where name = 'AC (Abandoned Checkout)'
   and not exists (select 1 from public.sources s2 where s2.name = 'AC');

update public.sources set name = 'Indv Whatsapp'
 where name = 'Indv WhatsApp'
   and not exists (select 1 from public.sources s2 where s2.name = 'Indv Whatsapp');

-- ---------------------------------------------------------------------------
-- Sources — the seven distinct channels in the sheet, after splitting the
-- comma-separated cells. An enquiry carries exactly one.
-- ---------------------------------------------------------------------------

insert into public.sources (name) values
  ('Knowlarity'),
  ('AC'),
  ('Interakt'),
  ('Indv Whatsapp'),
  ('Vsmart'),
  ('Request for Call Back'),
  ('Mobile Number 605')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Teachers — 73. Every name that appears on a call, minus two spreadsheet
-- artefacts (#ERROR!, CA_Final), with three spellings corrected, plus five
-- names carried on the Data tab's Faculty list that no call has used yet.
-- Ultimate CA, MEPL and Concept Classes are institutes rather than
-- individuals, and are kept as teachers deliberately.
-- ---------------------------------------------------------------------------

insert into public.teachers (name) values
  ('Aaditya Jain'),
  ('Aakash Kandoi'),
  ('Aarish Khan'),
  ('Aarti Lahoti'),
  ('Abhishek Bansal'),
  ('Abhishek Zaware'),
  ('Adish Jain'),
  ('Akshansh Garg'),
  ('Amit Mahajan'),
  ('Amit Tated'),
  ('Ankita Patni'),
  ('Anoop Jain'),
  ('Archana Khetan'),
  ('Arjun Chabra'),
  ('Arpita Tulsyan'),
  ('Ashish Kalra'),
  ('Avinash Sancheti'),
  ('Bhanwar Borana'),
  ('Chiranjeev Jain'),
  ('Concept Classes'),
  ('Darshan Khare'),
  ('Ekagrata'),
  ('Harsh Gupta'),
  ('Harshad Jaju'),
  ('Jai Chawla'),
  ('Kapil Goyal'),
  ('Manan Pujara'),
  ('Mayank Kothari'),
  ('Mayank Saraf'),
  ('MEPL'),
  ('Namit Arora'),
  ('Neeraj Arora'),
  ('Nikkhil Gupta'),
  ('Nitin Guru'),
  ('P S Beniwal'),
  ('Pankaj Garg'),
  ('Parveen Jindal'),
  ('Parveen Sharma'),
  ('Pavan Karmale'),
  ('Pragnesh Kanabar'),
  ('Pranav Popat'),
  ('Prashant Sarda'),
  ('Pratik Jagati'),
  ('Praveen Khatod'),
  ('Purushottam Aggarwal'),
  ('Rajkumar'),
  ('Ramesh Soni'),
  ('Ranjan Periwal'),
  ('Ranjay Mishra'),
  ('Ravi Taori'),
  ('Riddhi Baghmar'),
  ('Rishabh Jain'),
  ('Sanjay Khemka'),
  ('Sanjay Saraf'),
  ('Sankalp Kanstiya'),
  ('Santosh Agarwal'),
  ('Sarthak Jain'),
  ('Satish Jalan'),
  ('Shivangi Agarwal'),
  ('Shubham Keswani'),
  ('Shubham Singhal'),
  ('Siddharth Agarwal'),
  ('Siddhesh Valimbe'),
  ('Swapnil Patni'),
  ('Tarun Agarwal'),
  ('Tharun Raj'),
  ('Ultimate CA'),
  ('Vijay Sarda'),
  ('Vijendra Agarwal'),
  ('Vinod Reddy'),
  ('Vishal Bhattad'),
  ('Yashvant Mangal'),
  ('Yogendra Bangar')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Courses and subjects. ACCA and CFA carry no subjects yet; CS and CMA use the
-- three-level structure rather than paper names.
-- ---------------------------------------------------------------------------

insert into public.courses (name) values
  ('CA Final'),
  ('CA Inter'),
  ('CA Foundation'),
  ('CS'),
  ('CMA'),
  ('ACCA'),
  ('CFA')
on conflict (name) do nothing;

insert into public.subjects (course_id, name)
select c.id, v.name
  from public.courses c
 cross join (values
          ('FR'),
          ('AFM'),
          ('Audit'),
          ('DT'),
          ('IDT'),
          ('Set A Law'),
          ('Set B Cost'),
          ('IBS')
        ) as v(name)
 where c.name = 'CA Final'
on conflict (course_id, name) do nothing;

insert into public.subjects (course_id, name)
select c.id, v.name
  from public.courses c
 cross join (values
          ('Adv Account'),
          ('Law'),
          ('Audit'),
          ('Costing'),
          ('Taxation'),
          ('FM SM')
        ) as v(name)
 where c.name = 'CA Inter'
on conflict (course_id, name) do nothing;

insert into public.subjects (course_id, name)
select c.id, v.name
  from public.courses c
 cross join (values
          ('Accounts'),
          ('Law'),
          ('Maths & Stats'),
          ('Economics')
        ) as v(name)
 where c.name = 'CA Foundation'
on conflict (course_id, name) do nothing;

insert into public.subjects (course_id, name)
select c.id, v.name
  from public.courses c
 cross join (values
          ('Foundation'),
          ('Inter'),
          ('Final')
        ) as v(name)
 where c.name = 'CS'
on conflict (course_id, name) do nothing;

insert into public.subjects (course_id, name)
select c.id, v.name
  from public.courses c
 cross join (values
          ('Foundation'),
          ('Inter'),
          ('Final')
        ) as v(name)
 where c.name = 'CMA'
on conflict (course_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Contents, in the §6 priority order: lower number is called first.
--
-- Ordering columns are upserted, not left alone: a row created by the earlier
-- placeholder seed would otherwise keep its old number and collide with a new
-- one. That does mean re-running this seed resets any ordering changed by hand
-- in Settings — the sheet is the source of truth for order, not the database.
-- ---------------------------------------------------------------------------

insert into public.contents (name, priority) values
  ('Full', 1),
  ('FT', 2),
  ('EO', 3),
  ('Test Series', 4),
  ('Books', 5)
on conflict (name) do update set priority = excluded.priority;

-- ---------------------------------------------------------------------------
-- Terms — every attempt on the sheet from Nov-26 onward. May-26 and Sep-26 are
-- excluded: they had already passed when this was loaded.
--
-- sort_order is upserted for the reason given above the contents block: Jan-27
-- already existed from the placeholder seed with a different number.
-- ---------------------------------------------------------------------------

insert into public.terms (name, sort_order) values
  ('Nov-26', 1),
  ('Jan-27', 2),
  ('May-27', 3),
  ('Sep-27', 4),
  ('Nov-27', 5),
  ('Jan-28', 6),
  ('May-28', 7),
  ('Sep-28', 8),
  ('Nov-28', 9),
  ('Jan-29', 10),
  ('May-29', 11),
  ('Sep-29', 12),
  ('Nov-29', 13)
on conflict (name) do update set sort_order = excluded.sort_order;

-- Deactivate rather than delete the two excluded terms, in case the first
-- seed already created them. §2 never deletes; a deactivated option still
-- resolves on any historical row that referenced it.
update public.terms set is_active = false where name in ('May-26', 'Sep-26');

-- ---------------------------------------------------------------------------
-- WhatsApp templates (§5.10). Placeholders {name} and {course} are filled from
-- the enquiry. This wording is still a placeholder — replace it with
-- Zeroinfy's actual copy before go-live.
-- ---------------------------------------------------------------------------

insert into public.whatsapp_templates (name, body, sort_order) values
  ('Intro',
   'Hi {name}, this is Zeroinfy about your {course} enquiry. When would be a good time to talk?',
   1),
  ('Follow-up',
   'Hi {name}, following up on your {course} enquiry. Shall I share the details?',
   2),
  ('Offer reminder',
   'Hi {name}, the current offer on {course} closes shortly. Would you like me to hold your seat?',
   3)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Holidays — deliberately empty. Sundays are skipped by rule and Saturday is a
-- working day (§10 decision 12); the Zeroinfy holiday calendar is admin-managed
-- and has not been supplied.
-- ---------------------------------------------------------------------------
