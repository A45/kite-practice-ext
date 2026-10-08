-- Kite Practice teacher dashboard schema. Supabase → SQL Editor me poora paste karke Run karo.
-- Students (anon key) ko kisi table ka direct access NAHI hai; sirf 2 RPC: join_class, push_events.
-- Teacher (Supabase Auth login) sirf apni classes / students / events padh sakta hai.

create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  name       text not null default '',
  teacher    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id        uuid primary key default gen_random_uuid(),
  class_id  uuid not null references public.classes(id) on delete cascade,
  name      text not null check (length(name) between 1 and 60),
  token     uuid not null default gen_random_uuid(),
  joined_at timestamptz not null default now()
);
create index if not exists students_class_idx on public.students(class_id);

create table if not exists public.events (
  id          bigserial primary key,
  student_id  uuid not null references public.students(id) on delete cascade,
  ts          timestamptz not null,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists events_student_ts_idx on public.events(student_id, ts);
-- event kinds (v0.2: plan / risk / review add hue). Re-run safe: purana check hata ke naya.
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check
  check (kind in ('join','order','ic','adjust','alert','snapshot','settle','reset','plan','risk','review'));

alter table public.classes  enable row level security;
alter table public.students enable row level security;
alter table public.events   enable row level security;

-- token column teacher ko bhi na dikhe
revoke select on public.students from anon, authenticated;
grant select (id, class_id, name, joined_at) on public.students to authenticated;
revoke all on public.events from anon;
revoke all on public.classes from anon;

drop policy if exists teacher_classes on public.classes;
create policy teacher_classes on public.classes for all to authenticated
  using (teacher = auth.uid()) with check (teacher = auth.uid());

drop policy if exists teacher_students on public.students;
create policy teacher_students on public.students for select to authenticated
  using (exists (select 1 from public.classes c where c.id = class_id and c.teacher = auth.uid()));

drop policy if exists teacher_students_delete on public.students;
create policy teacher_students_delete on public.students for delete to authenticated
  using (exists (select 1 from public.classes c where c.id = class_id and c.teacher = auth.uid()));

drop policy if exists teacher_events on public.events;
create policy teacher_events on public.events for select to authenticated
  using (exists (select 1 from public.students s join public.classes c on c.id = s.class_id
                 where s.id = student_id and c.teacher = auth.uid()));

-- Student join: class code se. Returns student_id + secret token (extension local me rakhta hai).
create or replace function public.join_class(p_code text, p_name text)
returns table (student_id uuid, token uuid)
language plpgsql security definer set search_path = public as $$
declare c uuid; n text := left(trim(coalesce(p_name, '')), 60);
begin
  if n = '' then raise exception 'naam khaali hai'; end if;
  select id into c from classes where code = upper(trim(p_code));
  if c is null then raise exception 'class code nahi mila'; end if;
  if (select count(*) from students where class_id = c) >= 200 then raise exception 'class full (200)'; end if;
  return query insert into students(class_id, name) values (c, n) returning students.id, students.token;
end $$;

-- Events push: token match hona chahiye. Ek call me max 500 events, payload max 4 KB each.
create or replace function public.push_events(p_student uuid, p_token uuid, p_events jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not exists (select 1 from students where id = p_student and token = p_token) then
    raise exception 'invalid student token';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 500 then
    raise exception 'events array (max 500) chahiye';
  end if;
  insert into events(student_id, ts, kind, payload)
  select p_student,
         least(coalesce((e->>'ts')::timestamptz, now()), now() + interval '5 minutes'),
         e->>'kind',
         coalesce(e->'payload', '{}'::jsonb)
  from jsonb_array_elements(p_events) e
  where e->>'kind' in ('join','order','ic','adjust','alert','snapshot','settle','reset','plan','risk','review')
    and length(coalesce(e->'payload', '{}'::jsonb)::text) <= 4096;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.join_class(text, text) from public;
revoke all on function public.push_events(uuid, uuid, jsonb) from public;
grant execute on function public.join_class(text, text) to anon, authenticated;
grant execute on function public.push_events(uuid, uuid, jsonb) to anon, authenticated;
