-- 先在 Supabase Dashboard > Authentication > Users 建立管理員帳號，
-- 再將下方電子郵件替換成該帳號，於 SQL Editor 執行一次。
insert into public.admin_users (user_id, display_name)
select id, coalesce(raw_user_meta_data ->> 'display_name', email)
from auth.users
where email = 'replace-me@example.com'
on conflict (user_id) do update
set display_name = excluded.display_name;

-- 執行後確認已建立管理員授權：
select
  au.user_id,
  u.email,
  au.display_name,
  au.created_at
from public.admin_users au
join auth.users u on u.id = au.user_id;
