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
-- Counts: 7 sources · 73 teachers · 9 courses · 43 subjects · 5 contents
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
-- Courses and subjects (§11.1).
--
-- sort_order is the syllabus order, not alphabetical, and every filter, facet
-- and picker honours it. ACCA and CFA carry no subjects; CS keeps its
-- three-level structure rather than paper names.
--
-- Idempotent against a database that has already been reconciled: the upserts
-- set sort_order on conflict, so a re-run corrects drift without creating
-- duplicates and without touching anything else. The legacy single "CMA"
-- course and its Foundation/Inter/Final subjects are deliberately absent — a
-- fresh database goes straight to the three CMA levels.
-- ---------------------------------------------------------------------------

insert into public.courses (name, sort_order) values
  ('CA Final', 1),
  ('CA Inter', 2),
  ('CA Foundation', 3),
  ('CMA Final', 4),
  ('CMA Inter', 5),
  ('CMA Foundation', 6),
  ('ACCA', 7),
  ('CFA', 8),
  ('CS', 9)
on conflict (name) do update set sort_order = excluded.sort_order;

insert into public.subjects (course_id, name, sort_order)
select c.id, v.name, v.n
  from public.courses c
 cross join (values
          ('FR', 1),
          ('AFM/SFM', 2),
          ('Audit', 3),
          ('Direct Tax', 4),
          ('Indirect Tax', 5),
          ('Integrated Business Solutions', 6),
          ('Set A - Law', 7),
          ('Set B - Costing', 8)
        ) as v(name, n)
 where c.name = 'CA Final'
on conflict (course_id, name) do update set sort_order = excluded.sort_order;

insert into public.subjects (course_id, name, sort_order)
select c.id, v.name, v.n
  from public.courses c
 cross join (values
          ('Advanced Accounting', 1),
          ('Corporate Law', 2),
          ('Taxation', 3),
          ('Costing', 4),
          ('Audit and Ethics', 5),
          ('FM SM', 6)
        ) as v(name, n)
 where c.name = 'CA Inter'
on conflict (course_id, name) do update set sort_order = excluded.sort_order;

insert into public.subjects (course_id, name, sort_order)
select c.id, v.name, v.n
  from public.courses c
 cross join (values
          ('Accounts', 1),
          ('Law', 2),
          ('Maths & Stats', 3),
          ('Economics', 4)
        ) as v(name, n)
 where c.name = 'CA Foundation'
on conflict (course_id, name) do update set sort_order = excluded.sort_order;

insert into public.subjects (course_id, name, sort_order)
select c.id, v.name, v.n
  from public.courses c
 cross join (values
          ('Corporate Law (Paper 13)', 1),
          ('SFM (Paper 14)', 2),
          ('Direct Tax (Paper 15)', 3),
          ('SCM (Paper 16)', 4),
          ('Cost Audit (Paper 17)', 5),
          ('CFR (Paper 18)', 6),
          ('Indirect Tax (Paper 19)', 7),
          ('Elective SPMBV (Paper 20A)', 8),
          ('Elective Risk Management (Paper 20B)', 9),
          ('Elective Entrepreneurship And Startup (Paper 20C)', 10)
        ) as v(name, n)
 where c.name = 'CMA Final'
on conflict (course_id, name) do update set sort_order = excluded.sort_order;

insert into public.subjects (course_id, name, sort_order)
select c.id, v.name, v.n
  from public.courses c
 cross join (values
          ('Business Law (Paper 5)', 1),
          ('Financial Accounts (Paper 6)', 2),
          ('Direct & Indirect Tax (Paper 7)', 3),
          ('Cost Accounts (Paper 8)', 4),
          ('OM & SM (Paper 9)', 5),
          ('Corporate Accounts and Audit (Paper 10)', 6),
          ('FM & DA (Paper 11)', 7),
          ('Mgmt Accounts (Paper 12)', 8)
        ) as v(name, n)
 where c.name = 'CMA Inter'
on conflict (course_id, name) do update set sort_order = excluded.sort_order;

insert into public.subjects (course_id, name, sort_order)
select c.id, v.name, v.n
  from public.courses c
 cross join (values
          ('Business Law & Comm (Paper 1)', 1),
          ('Financial & Cost Accounting (Paper 2)', 2),
          ('Business Maths & Stats (Paper 3)', 3),
          ('Business Economics & Mgmt (Paper 4)', 4)
        ) as v(name, n)
 where c.name = 'CMA Foundation'
on conflict (course_id, name) do update set sort_order = excluded.sort_order;

insert into public.subjects (course_id, name, sort_order)
select c.id, v.name, v.n
  from public.courses c
 cross join (values
          ('Foundation', 1),
          ('Inter', 2),
          ('Final', 3)
        ) as v(name, n)
 where c.name = 'CS'
on conflict (course_id, name) do update set sort_order = excluded.sort_order;

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
