-- Run once in Supabase SQL Editor. Re-running keeps existing records.
-- Public shared workspace, explicitly requested by the owner: no login.
-- Everyone may read/manage records. Writes still go through validating RPCs.
begin;
create table if not exists public.lesson_records (
 id uuid primary key,
 owner_id uuid references auth.users(id) on delete set null,
 record jsonb not null,
 student_name text generated always as (record->>'studentName') stored,
 lesson_date text generated always as (record->>'lessonDate') stored,
 check_in text generated always as (record->>'checkIn') stored,
 course_name text generated always as (record->>'courseName') stored,
 teacher_name text generated always as (record#>'{signatures,mentor}'->>'text') stored,
 revision integer not null default 1,
 share_token uuid unique,
 share_expires_at timestamptz,
 signed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint lesson_record_size check (octet_length(record::text)<=100000)
);
create index if not exists lesson_owner_date on public.lesson_records(owner_id,lesson_date desc);
alter table public.lesson_records alter column owner_id drop not null;
alter table public.lesson_records add column if not exists teacher_name text generated always as (record#>'{signatures,mentor}'->>'text') stored;
alter table public.lesson_records enable row level security;
revoke all on public.lesson_records from anon, authenticated;
grant select on public.lesson_records to anon, authenticated;
drop policy if exists lesson_owner_read on public.lesson_records;
drop policy if exists lesson_public_read on public.lesson_records;
create policy lesson_public_read on public.lesson_records for select to anon, authenticated using (true);

create or replace function public.sfk_signature_valid(s jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare encoded text;
begin
 if s is null or jsonb_typeof(s)<>'object' then return false; end if;
 if s->>'mode'='text' then return jsonb_typeof(s->'text')='string' and length(s->>'text')<=24; end if;
 if s->>'mode'='image' then
  if s->'image'='null'::jsonb then return true; end if;
  encoded:=s->>'image';
  if encoded is null or length(encoded)>23000 or encoded !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+=*$' then return false; end if;
  return octet_length(decode(split_part(encoded,',',2),'base64'))<=16384;
 end if;
 return false;
exception when others then return false;
end $$;
create or replace function public.sfk_signature_present(s jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce((s->>'mode'='text' and length(btrim(s->>'text'))>0) or (s->>'mode'='image' and length(s->>'image')>0),false);
$$;
create or replace function public.sfk_record_valid(r jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; d date;
begin
 if r is null or jsonb_typeof(r)<>'object' or octet_length(r::text)>100000 then return false; end if;
 foreach k in array array['studentName','courseName','lessonDate','lessonNumber','checkIn','checkOut','content','homework'] loop
  if jsonb_typeof(r->k) is distinct from 'string' then return false; end if;
 end loop;
 if length(r->>'studentName')>80 or length(r->>'content')>12000 or length(r->>'homework')>12000 or r->>'courseName' not in ('项目课','基础/软件课') then return false; end if;
 if r->>'lessonNumber'<>'' and r->>'lessonNumber' !~ '^[1-9][0-9]{0,2}$' then return false; end if;
 if r->>'lessonDate'<>'' then
  if r->>'lessonDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  d:=(r->>'lessonDate')::date;
 end if;
 foreach k in array array['checkIn','checkOut'] loop
  if r->>k<>'' and r->>k !~ '^([01][0-9]|2[0-3]):(00|30)$' then return false; end if;
 end loop;
 if r->>'checkIn'<>'' and r->>'checkIn'=r->>'checkOut' then return false; end if;
 if not (r ? 'previousHomework') or r->'previousHomework' not in ('null'::jsonb,'"yes"'::jsonb,'"no"'::jsonb) then return false; end if;
 return coalesce(public.sfk_signature_valid(r#>'{signatures,student}') and public.sfk_signature_valid(r#>'{signatures,mentor}'),false);
exception when others then return false;
end $$;

create or replace function public.save_lesson(p_id uuid,p_expected_revision integer,p_record jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.lesson_records; result public.lesson_records; cleaned jsonb:=p_record; changed boolean:=false;
begin
 if not public.sfk_record_valid(p_record) then raise exception '记录格式不正确或签名超过 16 KB'; end if;
 select * into existing from public.lesson_records where id=p_id for update;
 if found then
  if existing.revision<>p_expected_revision then raise exception '记录已被更新，请返回管理页重新打开，避免覆盖学生签名'; end if;
  changed:=(existing.record #- '{signatures,student}')<>(cleaned #- '{signatures,student}');
  if changed and existing.signed_at is not null then
   cleaned:=jsonb_set(cleaned,'{signatures,student}','{"mode":"text","text":"","image":null,"strokes":[],"loading":false,"revision":0}'::jsonb);
  elsif existing.signed_at is not null then
   cleaned:=jsonb_set(cleaned,'{signatures,student}',existing.record#>'{signatures,student}');
  end if;
  update public.lesson_records set record=cleaned,revision=revision+1,updated_at=now(),
   signed_at=case when public.sfk_signature_present(cleaned#>'{signatures,student}') then coalesce(existing.signed_at,now()) else null end,
   share_token=case when changed then null else share_token end,
   share_expires_at=case when changed then null else share_expires_at end
   where id=p_id returning * into result;
 else
  if p_expected_revision<>0 then raise exception '记录已删除，请新建签单'; end if;
  insert into public.lesson_records(id,owner_id,record,signed_at) values(p_id,null,cleaned,
   case when public.sfk_signature_present(cleaned#>'{signatures,student}') then now() else null end) returning * into result;
 end if;
 return jsonb_build_object('id',result.id,'record',result.record,'revision',result.revision,'signed_at',result.signed_at,'updated_at',result.updated_at);
end $$;

create or replace function public.publish_lesson(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.lesson_records;
begin
 select * into r from public.lesson_records where id=p_id for update;
 if not found then raise exception '找不到这份记录'; end if;
 -- Repeated generation reuses a live token, so uncertain calls cannot create duplicates.
 if r.share_token is null or r.share_expires_at<=now() then
  update public.lesson_records set share_token=gen_random_uuid(),share_expires_at=now()+interval '30 days' where id=p_id returning * into r;
 end if;
 return jsonb_build_object('token',r.share_token,'expires_at',r.share_expires_at);
end $$;

create or replace function public.get_shared_lesson(p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.lesson_records;
begin
 select * into r from public.lesson_records where share_token=p_token and share_expires_at>now();
 if not found then raise exception '签名链接已失效、已过期或记录已删除，请联系老师'; end if;
 return jsonb_build_object('record',r.record,'signed_at',r.signed_at);
end $$;

create or replace function public.submit_lesson_signature(p_token uuid,p_signature jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.lesson_records;
begin
 if not public.sfk_signature_valid(p_signature) or not public.sfk_signature_present(p_signature) or octet_length(p_signature::text)>24000 then raise exception '签名无效或超过 16 KB，请重新签名'; end if;
 select * into r from public.lesson_records where share_token=p_token and share_expires_at>now() for update;
 if not found then raise exception '签名链接已失效，请联系老师'; end if;
 if r.signed_at is not null then return jsonb_build_object('signed_at',r.signed_at); end if;
 update public.lesson_records set record=jsonb_set(record,'{signatures,student}',p_signature),signed_at=now(),updated_at=now(),revision=revision+1 where id=r.id returning * into r;
 return jsonb_build_object('signed_at',r.signed_at);
end $$;

create or replace function public.delete_lesson(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from public.lesson_records where id=p_id;
end $$;

revoke all on function public.sfk_signature_valid(jsonb),public.sfk_signature_present(jsonb),public.sfk_record_valid(jsonb),public.save_lesson(uuid,integer,jsonb),public.publish_lesson(uuid),public.get_shared_lesson(uuid),public.submit_lesson_signature(uuid,jsonb),public.delete_lesson(uuid) from public,anon,authenticated;
grant execute on function public.save_lesson(uuid,integer,jsonb),public.publish_lesson(uuid),public.delete_lesson(uuid) to anon,authenticated;
grant execute on function public.get_shared_lesson(uuid),public.submit_lesson_signature(uuid,jsonb) to anon,authenticated;
commit;
