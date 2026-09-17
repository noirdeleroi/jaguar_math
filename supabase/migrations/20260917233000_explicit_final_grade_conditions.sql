-- Keep the reward rules visible and teacher-editable in the formula itself.
-- Only replace the exact legacy formula; preserve every custom expression.
update public.classroom_weeks
set final_grade_formula = 'N + max(stars - skulls, 0) + if(HW >= 10, 2, 0)'
where regexp_replace(lower(final_grade_formula), '[[:space:]]+', '', 'g') in (
  'n+stars-skulls+2',
  'n+star-skull+2',
  'n+stars-sculls+2',
  'n+star-scull+2',
  'n+stars-skulls',
  'n+star-skull',
  'n+stars-sculls',
  'n+star-scull'
);

comment on column public.classroom_weeks.final_grade_formula is
'Optional teacher-defined topic final-grade formula using N, stars, skulls, HW completion percentage, max/min, and if conditions. Null means final grades are not configured.';
