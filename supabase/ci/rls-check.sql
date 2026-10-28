-- Security checks for the Clients tables: people only ever see their own
-- team's clients, and can't plant one in another team. Run after every SQL
-- file by supabase/ci/run-all.sh. Fails loudly (raises) on any leak.

-- Two teams with one person each, plus someone on no team.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@team-a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@team-b.test'),
  ('00000000-0000-0000-0000-00000000000c', 'c@solo.test')
on conflict do nothing;
insert into public.organizations (id, name) values
  ('10000000-0000-0000-0000-00000000000a', 'Team A'),
  ('10000000-0000-0000-0000-00000000000b', 'Team B')
on conflict do nothing;
insert into public.profiles (id, email, organization_id) values
  ('00000000-0000-0000-0000-00000000000a', 'a@team-a.test', '10000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b', 'b@team-b.test', '10000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c', 'c@solo.test', null)
on conflict do nothing;
insert into public.bills (id, congress, bill_type, bill_number, title) values ('hr-1-119', 119, 'hr', 1, 'Test bill') on conflict do nothing;

-- Team B's client, created with the admin key.
insert into public.clients (id, organization_id, name) values ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'B''s client') on conflict do nothing;
insert into public.client_bills (client_id, bill_id) values ('20000000-0000-0000-0000-00000000000b', 'hr-1-119') on conflict do nothing;
insert into public.client_recipients (client_id, email) values ('20000000-0000-0000-0000-00000000000b', 'secret@client-b.test') on conflict do nothing;

do $$
declare n int;
begin
  -- As Team A's member.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  select count(*) into n from public.clients;            if n <> 0 then raise exception 'LEAK: team A sees % of team B''s clients', n; end if;
  select count(*) into n from public.client_bills;       if n <> 0 then raise exception 'LEAK: team A sees team B''s client bills'; end if;
  select count(*) into n from public.client_recipients;  if n <> 0 then raise exception 'LEAK: team A sees team B''s recipients'; end if;

  begin
    insert into public.clients (organization_id, name) values ('10000000-0000-0000-0000-00000000000b', 'planted');
    raise exception 'LEAK: team A created a client inside team B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.client_recipients (client_id, email) values ('20000000-0000-0000-0000-00000000000b', 'x@y.z');
    raise exception 'LEAK: team A added a recipient to team B''s client';
  exception when insufficient_privilege then null;
  end;

  insert into public.clients (organization_id, name) values ('10000000-0000-0000-0000-00000000000a', 'A''s client');
  select count(*) into n from public.clients;            if n <> 1 then raise exception 'team A should see exactly its own client, saw %', n; end if;
  select count(*) into n from public.committee_meetings; -- readable, no error
  reset role;
end $$;

do $$
declare n int;
begin
  -- Someone on no team keeps clients to themselves.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  insert into public.clients (user_id, name) values ('00000000-0000-0000-0000-00000000000c', 'Solo client');
  select count(*) into n from public.clients;  if n <> 1 then raise exception 'solo user should see only their client, saw %', n; end if;
  insert into public.calendar_feeds (user_id) values ('00000000-0000-0000-0000-00000000000c');
  reset role;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  set local role authenticated;
  select count(*) into n from public.calendar_feeds; if n <> 0 then raise exception 'LEAK: someone else''s calendar link is visible'; end if;
  reset role;
end $$;

-- Drug boards: shared with everyone signed in, never with the public, and
-- nobody can write history under someone else's name.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  select count(*) into n from public.drug_boards;   if n <> 0 then raise exception 'LEAK: signed-out visitors can read drug boards'; end if;
  select count(*) into n from public.board_drugs;   if n <> 0 then raise exception 'LEAK: signed-out visitors can read the drug tracker'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  select count(*) into n from public.drug_boards;   if n < 7 then raise exception 'signed-in users should see the boards, saw %', n; end if;
  begin
    insert into public.board_drug_changes (board_drug_id, changed_by, summary)
    values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000b', 'forged');
    raise exception 'LEAK: wrote drug history as someone else';
  exception when insufficient_privilege then null;
  end;
  insert into public.board_drug_changes (board_drug_id, changed_by, summary)
  values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'ok');
  begin
    update public.profiles set drug_board_alerts = true where id = '00000000-0000-0000-0000-00000000000b';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'LEAK: changed someone else''s email setting'; end if;
  end;
  reset role;
end $$;
delete from public.board_drug_changes where summary = 'ok';

-- Leave the throwaway database as it was.
delete from public.clients;
delete from public.calendar_feeds;
select 'Security checks passed' as result;
