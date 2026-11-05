-- 僅供已執行過舊版 schema.sql 的 Supabase 專案升級使用。
-- 全新專案直接執行 supabase/schema.sql 即可，不需要再執行本檔。
begin;

alter table public.candidates
  add column if not exists is_elected boolean not null default false;

alter table public.vote_logs
  add column if not exists action text not null default 'adjust';

alter table public.vote_logs
  drop constraint if exists vote_logs_action_check;

alter table public.vote_logs
  add constraint vote_logs_action_check
  check (action in ('adjust', 'set', 'elect', 'unelect'));

-- 舊 view 的欄位會保留，is_elected 追加在最後。
create or replace view public.public_candidates as
select
  id,
  ballot_no,
  name,
  photo_path,
  theme_color,
  votes,
  updated_at,
  is_elected
from public.candidates;

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

  if p_request_id is null or p_is_elected is null then
    raise exception '缺少當選操作必要資料。'
      using errcode = '22023';
  end if;

  select candidate_id
    into v_log_candidate_id
    from public.vote_logs
   where request_id = p_request_id;

  if found then
    if v_log_candidate_id <> p_candidate_id then
      raise exception '操作識別碼與候選人不一致。'
        using errcode = '22023';
    end if;

    return query
      select c.id, c.ballot_no, c.name, c.photo_path, c.theme_color,
             c.votes, c.is_elected, c.updated_at
      from public.candidates c
      where c.id = p_candidate_id;
    return;
  end if;

  select c.votes, c.is_elected
    into v_current_votes, v_old_elected
    from public.candidates c
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
    from public.candidates c
    where c.id = p_candidate_id;
end;
$$;

revoke all on function public.set_candidate_elected(uuid, boolean, uuid)
  from public, anon;
grant execute on function public.set_candidate_elected(uuid, boolean, uuid)
  to authenticated;

commit;
