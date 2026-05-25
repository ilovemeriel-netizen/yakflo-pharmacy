-- ════════════════════════════════════════════════════════════════
-- CNC Pharmacy · 사용자 프로필 (profiles) 테이블 + RLS + 트리거
-- 실행 위치: Supabase Dashboard → SQL Editor
-- 안전 재실행 가능 (IF NOT EXISTS / DROP POLICY IF EXISTS 사용)
-- ════════════════════════════════════════════════════════════════

-- 1) profiles 테이블
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  dept        text,
  position    text,
  role        text not null default 'user',  -- 'user' | 'admin'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2) updated_at 자동 갱신 트리거
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 3) 신규 가입 시 profiles 행 자동 생성 (이메일/카카오/네이버 모두 처리)
--    소셜 가입자는 user_metadata에 nickname/full_name 등이 포함됨 → 자동 추출
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  derived_name text := coalesce(
    meta->>'full_name',
    meta->>'name',
    meta->>'nickname',
    meta->>'user_name',
    null
  );
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, derived_name)
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) 기존 가입자 백필 (이미 있는 auth.users 중 profiles에 없는 행 채워넣기)
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 5) RLS 활성화
alter table public.profiles enable row level security;

-- 6) 정책 — 본인 행 조회/수정 + 관리자 전체 조회
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- 관리자: role='admin'인 사용자는 전체 조회 가능
-- (재귀 방지를 위해 SECURITY DEFINER 함수로 권한 체크)
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "profiles_select_admin_all" on public.profiles;
create policy "profiles_select_admin_all" on public.profiles
  for select using (public.is_admin());

-- ════════════════════════════════════════════════════════════════
-- 7) 첫 관리자 지정 (본인 이메일 — 다른 사람을 관리자로 만들려면 이메일만 변경)
-- ════════════════════════════════════════════════════════════════
update public.profiles set role = 'admin' where email = 'ilovemeriel@gmail.com';
