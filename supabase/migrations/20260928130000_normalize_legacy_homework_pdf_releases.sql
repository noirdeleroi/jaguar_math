-- Before automatic deadline release, this timestamp meant "approved for release
-- after the deadline." Clear those legacy approvals so they are not interpreted
-- as a new immediate-release choice. Past-due homework remains available through
-- the due_at rule, and teachers can explicitly release future homework again.

update public.assignments
set homework_pdf_released_at = null
where kind = 'homework'
  and homework_pdf_released_at is not null;
