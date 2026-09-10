create policy "teacher star settings: enrolled students read"
on public.teacher_star_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.classes classroom
    join public.class_members member on member.class_id = classroom.id
    where classroom.teacher_id = teacher_star_settings.teacher_id
      and member.student_id = auth.uid()
  )
);
