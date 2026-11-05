-- 修正計票函式中 id 與 is_elected 欄位名稱的歧義。
begin;

create or replace function public.adjust_candidate_votes(
  p_candidate_id uuid,
  p_delta integer,
  p_request_id uuid
)
returns table (
  id uuid,
  ballot_no integer,
  name text,
  photo_path text,
  theme_color text,
  votes integer,
  is_elected boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_votes integer;
  v_new_votes integer;
  v_actual_delta integer;
  v_log_candidate_id uuid;
begin
  if not public.is_admin() then
    raise exception '沒有計票管理權限。'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception '缺少操作識別碼。'
      using errcode = '22023';
  end if;

  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then
    raise exception '單次票數調整必須是 -1000 至 1000 之間的非零整數。'
      using errcode = '22023';
  end if;

  select log_entry.candidate_id
    into v_log_candidate_id
    from public.vote_logs as log_entry
   where log_entry.request_id = p_request_id;

  if found then
    if v_log_candidate_id <> p_candidate_id then
      raise exception '操作識別碼與候選人不一致。'
        using errcode = '22023';
    end if;

    return query
      select c.id, c.ballot_no, c.name, c.photo_path, c.theme_color,
             c.votes, c.is_elected, c.updated_at
      from public.candidates as c
      where c.id = p_candidate_id;
    return;
  end if;

  select c.votes
    into v_old_votes
    from public.candidates as c
   where c.id = p_candidate_id
   for update;

  if not found then
    raise exception '找不到候選人資料。'
      using errcode = 'P0002';
  end if;

  v_new_votes := greatest(0, least(999999, v_old_votes + p_delta));
  v_actual_delta := v_new_votes - v_old_votes;

  if v_actual_delta <> 0 then
    update public.candidates as target_candidate
       set votes = v_new_votes,
           updated_at = now()
     where target_candidate.id = p_candidate_id;

    insert into public.vote_logs (
      request_id,
      candidate_id,
      old_votes,
      new_votes,
      delta,
      action,
      operator_id
    )
    values (
      p_request_id,
      p_candidate_id,
      v_old_votes,
      v_new_votes,
      v_actual_delta,
      'adjust',
      auth.uid()
    );
  end if;

  return query
    select c.id, c.ballot_no, c.name, c.photo_path, c.theme_color,
           c.votes, c.is_elected, c.updated_at
    from public.candidates as c
    where c.id = p_candidate_id;
end;
$$;

create or replace function public.set_candidate_votes(
  p_candidate_id uuid,
  p_new_votes integer,
  p_request_id uuid
)
returns table (
  id uuid,
  ballot_no integer,
  name text,
  photo_path text,
  theme_color text,
  votes integer,
  is_elected boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_votes integer;
  v_log_candidate_id uuid;
begin
  if not public.is_admin() then
    raise exception '沒有計票管理權限。'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception '缺少操作識別碼。'
      using errcode = '22023';
  end if;

  if p_new_votes is null or p_new_votes < 0 or p_new_votes > 999999 then
    raise exception '票數必須是 0 至 999999 的整數。'
      using errcode = '22023';
  end if;

  select log_entry.candidate_id
    into v_log_candidate_id
    from public.vote_logs as log_entry
   where log_entry.request_id = p_request_id;

  if found then
    if v_log_candidate_id <> p_candidate_id then
      raise exception '操作識別碼與候選人不一致。'
        using errcode = '22023';
    end if;

    return query
      select c.id, c.ballot_no, c.name, c.photo_path, c.theme_color,
             c.votes, c.is_elected, c.updated_at
      from public.candidates as c
      where c.id = p_candidate_id;
    return;
  end if;

  select c.votes
    into v_old_votes
    from public.candidates as c
   where c.id = p_candidate_id
   for update;

  if not found then
    raise exception '找不到候選人資料。'
      using errcode = 'P0002';
  end if;

  if v_old_votes <> p_new_votes then
    update public.candidates as target_candidate
       set votes = p_new_votes,
           updated_at = now()
     where target_candidate.id = p_candidate_id;

    insert into public.vote_logs (
      request_id,
      candidate_id,
      old_votes,
      new_votes,
      delta,
      action,
      operator_id
    )
    values (
      p_request_id,
      p_candidate_id,
      v_old_votes,
      p_new_votes,
      p_new_votes - v_old_votes,
      'set',
      auth.uid()
    );
  end if;

  return query
    select c.id, c.ballot_no, c.name, c.photo_path, c.theme_color,
           c.votes, c.is_elected, c.updated_at
    from public.candidates as c
    where c.id = p_candidate_id;
end;
$$;

create or replace function public.set_candidate_elected(
  p_candidate_id uuid,
  p_is_elected boolean,
  p_request_id uuid
)
returns table (
  id uuid,
  ballot_no integer,
  name text,
  photo_path text,
  theme_color text,
  votes integer,
  is_elected boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_elected boolean;
  v_current_votes integer;
  v_elected_count integer;
  v_log_candidate_id uuid;
begin
  if not public.is_admin() then
    raise exception '沒有計票管理權限。'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception '缺少操作識別碼。'
      using errcode = '22023';
  end if;

  if p_is_elected is null then
    raise exception '缺少當選狀態。'
      using errcode = '22023';
  end if;

  select log_entry.candidate_id
    into v_log_candidate_id
    from public.vote_logs as log_entry
   where log_entry.request_id = p_request_id;

  if found then
    if v_log_candidate_id <> p_candidate_id then
      raise exception '操作識別碼與候選人不一致。'
        using errcode = '22023';
    end if;

    return query
      select c.id, c.ballot_no, c.name, c.photo_path, c.theme_color,
             c.votes, c.is_elected, c.updated_at
      from public.candidates as c
      where c.id = p_candidate_id;
    return;
  end if;

  select c.votes, c.is_elected
    into v_current_votes, v_old_elected
    from public.candidates as c
   where c.id = p_candidate_id
   for update;

  if not found then
    raise exception '找不到候選人資料。'
      using errcode = 'P0002';
  end if;

  if v_old_elected <> p_is_elected then
    if p_is_elected then
      perform pg_advisory_xact_lock(20261105);

      select count(*)
        into v_elected_count
        from public.candidates as elected_candidate
       where elected_candidate.is_elected;

      if v_elected_count >= 6 then
        raise exception '最多只能標記六位候選人當選。'
          using errcode = '23514';
      end if;
    end if;

    update public.candidates as target_candidate
       set is_elected = p_is_elected,
           updated_at = now()
     where target_candidate.id = p_candidate_id;

    insert into public.vote_logs (
      request_id,
      candidate_id,
      old_votes,
      new_votes,
      delta,
      action,
      operator_id
    )
    values (
      p_request_id,
      p_candidate_id,
      v_current_votes,
      v_current_votes,
      0,
      case when p_is_elected then 'elect' else 'unelect' end,
      auth.uid()
    );
  end if;

  return query
    select c.id, c.ballot_no, c.name, c.photo_path, c.theme_color,
           c.votes, c.is_elected, c.updated_at
    from public.candidates as c
    where c.id = p_candidate_id;
end;
$$;

revoke all on function public.adjust_candidate_votes(uuid, integer, uuid)
  from public, anon;
revoke all on function public.set_candidate_votes(uuid, integer, uuid)
  from public, anon;
revoke all on function public.set_candidate_elected(uuid, boolean, uuid)
  from public, anon;

grant execute on function public.adjust_candidate_votes(uuid, integer, uuid)
  to authenticated;
grant execute on function public.set_candidate_votes(uuid, integer, uuid)
  to authenticated;
grant execute on function public.set_candidate_elected(uuid, boolean, uuid)
  to authenticated;

commit;
