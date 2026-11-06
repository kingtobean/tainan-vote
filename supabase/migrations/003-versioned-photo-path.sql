begin;

alter table public.candidates
  drop constraint if exists candidates_photo_path_check;

alter table public.candidates
  add constraint candidates_photo_path_check
  check (photo_path ~ '^/assets/candidates/[0-9]{2}(-v[0-9]+)?\.webp$');

update public.candidates
set photo_path = '/assets/candidates/09-v2.webp',
    updated_at = now()
where ballot_no = 9;

commit;
