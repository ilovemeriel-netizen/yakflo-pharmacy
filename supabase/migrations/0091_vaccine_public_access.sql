-- 0091: 백신 잔량 공개 조회 — 표시명 컬럼 + 공개 설정·실패 잠금 테이블 (DB 준비만)
-- 배경: 백신 잔량을 원내 공개 화면으로 조회하게 한다. 이번 단계는 DB 준비만이며
--       화면(JSX)·Netlify Function·netlify 설정은 포함하지 않는다.
-- 성격: 컬럼 1개 추가 + 테이블 2개 신설 + 현재 절기 표시명 5행 설정.
--       vaccine_events · v_vaccine_balance · 기존 RLS 정책 · 기존 트리거는 건드리지 않는다.
--       신규 2테이블은 RLS enable + 정책 0개 = service_role 만 접근한다(anon·authenticated 권한 부여 없음).
-- 적용: Supabase SQL Editor(운영 phgkjrvdtcdrdiuigici) 또는 scripts/apply_0091.mjs.

-- ── 1. 공개 표시명 ──────────────────────────────────────────────────────────
alter table public.vaccine_accounts add column if not exists public_label text;

alter table public.vaccine_accounts drop constraint if exists vaccine_accounts_public_label_chk;
alter table public.vaccine_accounts add  constraint vaccine_accounts_public_label_chk
  check (public_label is null or char_length(public_label) between 1 and 30);

comment on column public.vaccine_accounts.public_label is '공개 조회 화면에 표시할 이름. NULL 이면 공개 화면에 내지 않는다';

-- ── 2. 공개 화면 비밀번호 (테넌트당 1행) ────────────────────────────────────
create table if not exists public.vaccine_public_settings (
  tenant_id   uuid primary key references public.tenants(id),
  pw_hash     text,
  pw_salt     text,
  updated_at  timestamptz not null default now()
);

alter table public.vaccine_public_settings enable row level security;
-- ★ 정책을 만들지 않는다 — RLS 가 켜지고 정책이 0개면 service_role 외에는 아무 행도 보이지 않는다.

comment on table public.vaccine_public_settings is '백신 공개 조회 화면 비밀번호. service_role 전용(RLS 정책 0개)';

-- ── 3. 실패 잠금 (IP 해시 단위) ─────────────────────────────────────────────
create table if not exists public.vaccine_public_attempts (
  tenant_id     uuid not null references public.tenants(id),
  ip_hash       text not null,
  fail_count    smallint not null default 0,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, ip_hash)
);

alter table public.vaccine_public_attempts enable row level security;
-- ★ 정책을 만들지 않는다 — 위와 같다.

comment on table public.vaccine_public_attempts is '백신 공개 조회 실패 잠금. ip_hash 만 저장하고 IP 원문은 저장하지 않는다. service_role 전용(RLS 정책 0개)';
comment on column public.vaccine_public_attempts.ip_hash is 'IP 해시. 해시 생성은 Function 책임이며 원문 IP 를 적지 않는다';

-- ── 4. 현재 절기 표시명 초기값 (cnc · 2026-2027 한정, 정확히 5행) ───────────
update public.vaccine_accounts a set public_label = v.label
from (values
  ('TT-FLU44', '독감(유료)'),
  ('TETRA6',   '독감(국가무료)'),
  ('TETRA5',   '독감(지자체)'),
  ('SPIKVX',   '코로나(모더나)'),
  ('CMNTLP',   '코로나(화이자)')
) as v(drug_code, label)
where a.drug_code = v.drug_code
  and a.season = '2026-2027'
  and a.tenant_id = (select t.id from public.tenants t where t.slug = 'cnc');

-- 롤백:
--   alter table public.vaccine_accounts drop constraint if exists vaccine_accounts_public_label_chk;
--   alter table public.vaccine_accounts drop column if exists public_label;
--   drop table if exists public.vaccine_public_attempts;
--   drop table if exists public.vaccine_public_settings;
