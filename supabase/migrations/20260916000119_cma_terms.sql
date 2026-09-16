-- §49. The CMA exam cycle sits in December and June, and the terms master had
-- neither: the catalogue names Dec-26 twenty-eight times and Jun-27 three, and
-- every one of those titles was parsing to a blank term.
--
-- Sep-26 and May-26 are not added. They exist already, deactivated, because
-- they are past — which is the right answer for a lead arriving now, and means
-- the 229 titles naming them stay term-blank rather than being filed against
-- an exam that has been and gone.
insert into public.terms (name, sort_order, is_active)
select v.name, 0, true
  from (values ('Dec-26'), ('Jun-27'), ('Dec-27'), ('Jun-28'), ('Dec-28')) as v(name)
 where not exists (select 1 from public.terms t where t.name = v.name);

-- Renumber every active term from its own month and year, rather than by hand.
--
-- The list is read in this order everywhere it is offered, and it was already
-- not in order — two rows shared sort_order 1 and two more shared 2 — so
-- slotting five new rows in by eye would have compounded a problem rather than
-- fixed one. Derived from the name, it cannot drift again.
with ordered as (
  select t.id,
         row_number() over (
           order by
             -- "Nov-26" → 2026, then the month.
             (2000 + substring(t.name from '(\d{2})$')::int),
             case lower(substring(t.name from '^(\w{3})'))
               when 'jan' then 1 when 'feb' then 2 when 'mar' then 3
               when 'apr' then 4 when 'may' then 5 when 'jun' then 6
               when 'jul' then 7 when 'aug' then 8 when 'sep' then 9
               when 'oct' then 10 when 'nov' then 11 when 'dec' then 12
             end
         ) as n
    from public.terms t
   where t.is_active
)
update public.terms t
   set sort_order = ordered.n
  from ordered
 where t.id = ordered.id
   and t.sort_order is distinct from ordered.n;
