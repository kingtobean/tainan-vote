-- 可重複執行；重新執行不會重設既有票數。
insert into public.candidates (
  ballot_no,
  name,
  photo_path,
  theme_color,
  votes
)
values
  (1, '郭如芳', '/assets/candidates/01.webp', '#e2e5e8', 0),
  (2, '吳禹寰', '/assets/candidates/02.webp', '#9a514b', 0),
  (3, '翁語含', '/assets/candidates/03.webp', '#2f78c4', 0),
  (4, '杜素吟', '/assets/candidates/04.webp', '#9a514b', 0),
  (5, '劉正昌', '/assets/candidates/05.webp', '#e0b83b', 0),
  (6, '許又仁', '/assets/candidates/06.webp', '#9a514b', 0),
  (7, '陳皇宇', '/assets/candidates/07.webp', '#3f9b70', 0),
  (8, '郭鴻儀', '/assets/candidates/08-v3.webp', '#3f9b70', 0),
  (9, '鄭佳欣', '/assets/candidates/09-v2.webp', '#3f9b70', 0)
on conflict (ballot_no) do update
set
  name = excluded.name,
  photo_path = excluded.photo_path,
  theme_color = excluded.theme_color;
