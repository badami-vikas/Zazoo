-- apply_data_signal — SECURITY DEFINER dispatcher for data-processing Signals.
-- Mirrors apply_dedup_signal: a signal is the human-approved draft; this function
-- performs the privileged mutation server-side and marks the signal applied.
-- Apply via Supabase migration. NOT yet applied to prod.
--
-- Signal payload shapes (jsonb):
--   data.company_cleanup : { }                       -- nulls junk current_company_name
--   data.company_merge   : { "map": { "<variant>": "<canonical>", ... } }
--   data.eta_replace     : { "people": [ ...rows ], "delete_domains": [ ... ] }  (see note)

create or replace function apply_data_signal(p_signal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s          signals%rowtype;
  v_type     text;
  v_payload  jsonb;
  v_n        int := 0;
  v_detail   text := '';
  k          text;
  v          text;
begin
  select * into s from signals where id = p_signal_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'signal not found'); end if;
  if s.status = 'applied' then return jsonb_build_object('ok', true, 'status', 'applied', 'detail', 'already applied'); end if;

  v_type := s.type;
  v_payload := coalesce(s.payload, '{}'::jsonb);

  if v_type = 'data.company_cleanup' then
    -- Null employment-type / tenure-string / company==person-name junk so the
    -- Community page (DISTINCT current_company_name) stops rendering bogus pills.
    update people_canonical
      set current_company_name = null
      where current_company_name is not null
        and (
          lower(btrim(current_company_name)) in
            ('full-time','part-time','self-employed','self employed','freelance','freelancer',
             'contract','internship','seasonal','stealth startup','stealth mode startup','stealth ai startup')
          or current_company_name ~* '^\s*\d+\s*(yr|yrs|mo|mos|year|month)'
          or current_company_name ~* '\d+\s*(yrs?|mos?)\b'
          or btrim(lower(current_company_name)) = btrim(lower(full_name))
        );
    get diagnostics v_n = row_count;
    v_detail := format('company_cleanup: nulled %s junk company names', v_n);

  elsif v_type = 'data.company_merge' then
    -- Collapse fuzzy variants to one canonical spelling per the approved map.
    for k, v in select * from jsonb_each_text(v_payload->'map') loop
      update people_canonical
        set current_company_name = v
        where current_company_name = k and current_company_name is distinct from v;
      get diagnostics v_n = v_n + row_count;
    end loop;
    v_detail := format('company_merge: repointed %s rows across %s variants',
                       v_n, (select count(*) from jsonb_object_keys(v_payload->'map')));

  elsif v_type = 'data.eta_replace' then
    -- NOTE: the searcher-site replace (delete 127 prior garbage rows + insert 276
    -- clean people + ETA membership) is staged as SQL in
    -- My Data/ETA/scraper/investors/{del1,del2,del3,load}.sql. Porting that multi-
    -- statement load into this function is deferred; run those files (or grant the
    -- one-time write) to apply. Marked here so the signal isn't silently lost.
    return jsonb_build_object('ok', false, 'error',
      'eta_replace not implemented in RPC; apply staged SQL del1-3.sql + load.sql');

  else
    return jsonb_build_object('ok', false, 'error', 'unknown data signal type: ' || v_type);
  end if;

  update signals set status = 'applied',
    payload = v_payload || jsonb_build_object('applied_detail', v_detail)
    where id = p_signal_id;

  return jsonb_build_object('ok', true, 'status', 'applied', 'detail', v_detail, 'rows', v_n);
end;
$$;

-- Allow the authenticated role (member JWT) to invoke it, like apply_dedup_signal.
grant execute on function apply_data_signal(uuid) to authenticated, service_role;
