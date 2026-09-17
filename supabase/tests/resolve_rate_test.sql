-- §50B.1 tests for accounts.resolve_rate.
--
-- Plain SQL rather than pgTAP, which is not installed on the hosted project.
-- Everything runs inside one DO block, so it is one transaction: the ZTEST-
-- rows are deleted at the end, and if any assertion throws they are rolled
-- back instead. Either way nothing survives the run.
create temp table _rr(n int, name text, expected text, got text, pass boolean);

do $$
declare
  v_vendor  uuid;
  v_other   uuid;
  r_pct     numeric;
  r_src     text;
  r_id      uuid;
  id_old    uuid;
  id_new    uuid;
  id_state  uuid;
  id_combo  uuid;
begin
  insert into accounts.vendors (name, kind, institute)
       values ('ZTEST-Resolve Vendor', 'teacher', 'ZTEST-Institute')
    returning id into v_vendor;
  insert into accounts.vendors (name, kind)
       values ('ZTEST-Other Vendor', 'teacher')
    returning id into v_other;

  ---------------------------------------------------------------- 1. no rate
  select pct, source, rate_id into r_pct, r_src, r_id
    from accounts.resolve_rate(v_vendor, 'CA Final', 'Full', false, null,
                               date '2026-08-15', 'Maharashtra');
  insert into _rr values (1, 'no rate at all returns none',
    'none / null', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'none' and r_pct is null and r_id is null);

  ------------------------------------------------------------- 2. grid rate
  insert into accounts.rate_grid (vendor_id, level, product_type, pct, effective_from)
       values (v_vendor, 'CA Final', 'Full', 30.00, date '2026-08-01');

  select pct, source, rate_id into r_pct, r_src, r_id
    from accounts.resolve_rate(v_vendor, 'CA Final', 'Full', false, null,
                               date '2026-08-15', 'Maharashtra');
  insert into _rr values (2, 'open-ended grid row applies',
    'grid / 30.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'grid' and r_pct = 30.00);

  -- a different vendor must not see it
  select pct, source into r_pct, r_src
    from accounts.resolve_rate(v_other, 'CA Final', 'Full', false, null,
                               date '2026-08-15', 'Maharashtra');
  insert into _rr values (3, 'grid row does not leak to another vendor',
    'none / null', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'none' and r_pct is null);

  ----------------------------------------- 4. period-bound row, outside window
  insert into accounts.rate_grid (vendor_id, level, product_type, pct,
                                  effective_from, effective_to)
       values (v_vendor, 'CA Inter', 'EO', 45.00,
               date '2026-08-01', date '2026-08-31');

  select pct, source into r_pct, r_src
    from accounts.resolve_rate(v_vendor, 'CA Inter', 'EO', false, null,
                               date '2026-08-15', null);
  insert into _rr values (4, 'closed window applies inside itself',
    'grid / 45.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'grid' and r_pct = 45.00);

  select pct, source into r_pct, r_src
    from accounts.resolve_rate(v_vendor, 'CA Inter', 'EO', false, null,
                               date '2026-09-01', null);
  insert into _rr values (5, 'closed window does not apply after effective_to',
    'none / null', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'none' and r_pct is null);

  select pct, source into r_pct, r_src
    from accounts.resolve_rate(v_vendor, 'CA Inter', 'EO', false, null,
                               date '2026-07-31', null);
  insert into _rr values (6, 'closed window does not apply before effective_from',
    'none / null', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'none' and r_pct is null);

  ------------------------------------------------- 7. state rule beats grid
  insert into accounts.rate_grid (vendor_id, level, product_type, pct,
                                  effective_from, state_scope)
       values (v_vendor, 'CA Final', 'Full', 35.00, date '2026-08-01',
               array['Maharashtra','Gujarat'])
    returning id into id_state;

  select pct, source, rate_id into r_pct, r_src, r_id
    from accounts.resolve_rate(v_vendor, 'CA Final', 'Full', false, null,
                               date '2026-08-15', 'Maharashtra');
  insert into _rr values (7, 'state rule beats the general grid row',
    'state_rule / 35.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'state_rule' and r_pct = 35.00 and r_id = id_state);

  select pct, source into r_pct, r_src
    from accounts.resolve_rate(v_vendor, 'CA Final', 'Full', false, null,
                               date '2026-08-15', 'Kerala');
  insert into _rr values (8, 'a state outside the scope falls back to grid',
    'grid / 30.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'grid' and r_pct = 30.00);

  select pct, source into r_pct, r_src
    from accounts.resolve_rate(v_vendor, 'CA Final', 'Full', false, null,
                               date '2026-08-15', null);
  insert into _rr values (9, 'a line with no state falls back to grid',
    'grid / 30.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'grid' and r_pct = 30.00);

  ----------------------------------------------------- 10. combo beats grid
  insert into accounts.combo_rates (vendor_id, combo_key, display_title, pct,
                                    effective_from)
       values (v_vendor, 'ztest-combo-key', 'ZTEST- Combo Title', 22.00,
               date '2026-08-01')
    returning id into id_combo;

  select pct, source, rate_id into r_pct, r_src, r_id
    from accounts.resolve_rate(v_vendor, 'CA Final', 'Full', true,
                               'ztest-combo-key', date '2026-08-15', 'Maharashtra');
  insert into _rr values (10, 'combo beats both the state rule and the grid',
    'combo / 22.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'combo' and r_pct = 22.00 and r_id = id_combo);

  -- flagged as a combo but the key matches nothing: fall through, do not fail
  select pct, source into r_pct, r_src
    from accounts.resolve_rate(v_vendor, 'CA Final', 'Full', true,
                               'ztest-no-such-key', date '2026-08-15', 'Kerala');
  insert into _rr values (11, 'unmatched combo key falls through to the grid',
    'grid / 30.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'grid' and r_pct = 30.00);

  ------------------------------------------ 12. overlapping rows, later wins
  insert into accounts.rate_grid (vendor_id, level, product_type, pct, effective_from)
       values (v_vendor, 'CMA Final', 'FT', 20.00, date '2026-06-01')
    returning id into id_old;
  insert into accounts.rate_grid (vendor_id, level, product_type, pct, effective_from)
       values (v_vendor, 'CMA Final', 'FT', 25.00, date '2026-08-01')
    returning id into id_new;

  select pct, source, rate_id into r_pct, r_src, r_id
    from accounts.resolve_rate(v_vendor, 'CMA Final', 'FT', false, null,
                               date '2026-08-15', null);
  insert into _rr values (12, 'two open rows overlap: later effective_from wins',
    'grid / 25.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'grid' and r_pct = 25.00 and r_id = id_new);

  select pct, source, rate_id into r_pct, r_src, r_id
    from accounts.resolve_rate(v_vendor, 'CMA Final', 'FT', false, null,
                               date '2026-07-15', null);
  insert into _rr values (13, 'before the newer row, the older one still applies',
    'grid / 20.00', coalesce(r_src,'?') || ' / ' || coalesce(r_pct::text,'null'),
    r_src = 'grid' and r_pct = 20.00 and r_id = id_old);

  ------------------------------------------------- 14. the key normaliser
  insert into _rr values (14, 'normalise_key cuts at "by" and hyphenates',
    'ca-final-afm-combo',
    coalesce(accounts.normalise_key('CA Final AFM (Combo) by CA Aaditya Jain'), 'null'),
    accounts.normalise_key('CA Final AFM (Combo) by CA Aaditya Jain') = 'ca-final-afm-combo');

  insert into _rr values (15, 'normalise_key collapses punctuation runs',
    'ca-inter-law-set-a',
    coalesce(accounts.normalise_key('  CA Inter -- Law / Set A  '), 'null'),
    accounts.normalise_key('  CA Inter -- Law / Set A  ') = 'ca-inter-law-set-a');

  insert into _rr values (16, 'normalise_key returns null for an empty title',
    'null', coalesce(accounts.normalise_key('   ---  '), 'null'),
    accounts.normalise_key('   ---  ') is null);

  ------------------------------------------------------------------ cleanup
  delete from accounts.rate_grid   where vendor_id in (v_vendor, v_other);
  delete from accounts.combo_rates where vendor_id in (v_vendor, v_other);
  delete from accounts.vendors     where id in (v_vendor, v_other);
end $$;

select n,
       case when pass then 'PASS' else 'FAIL' end as result,
       name,
       expected,
       got
  from _rr
 order by n;
