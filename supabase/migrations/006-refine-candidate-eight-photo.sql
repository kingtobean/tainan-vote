begin;

update public.candidates
set photo_path = '/assets/candidates/08-v4.webp',
    updated_at = now()
where ballot_no = 8;

commit;
