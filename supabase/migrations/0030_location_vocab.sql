-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0030 위치 통제어휘 location_vocab — 테넌트별·가역
-- 실행: Supabase Management API. IF NOT EXISTS / ON CONFLICT(재실행 안전).
--
-- 목적: 약품 보관'위치' 통제어휘(병원별 상이) — drug_vocab(전 테넌트 공유)와 분리.
--   대시보드 '사용 중인 약품' 표의 위치 드롭다운이 이 테이블에서 값을 로드(하드코딩 금지).
--   추후 환경설정 화면에서 CRUD(2단계). 현재는 기본 15종 시드만.
-- RLS: tenant_id + current_tenant_ids() 격리(0001 패턴). allow_all 금지.
-- 기본값 15종은 전 테넌트에 시드(tenants 조인). 약품별 위치 데이터는 생성하지 않음(빈값 유지).
-- ════════════════════════════════════════════════════════════════

create table if not exists public.location_vocab (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,                 -- 정규 값(현재 label과 동일 사용)
  label text not null,                -- 표시명 (예: '향정금고 S-1')
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, label)
);
create index if not exists idx_location_vocab_tenant on public.location_vocab(tenant_id);

comment on table public.location_vocab is
  '약품 보관위치 통제어휘(테넌트별). 대시보드 위치 드롭다운 로드원. drug_vocab(공유)와 분리·RLS 격리.';

-- ── 기본 15종 시드 (전 테넌트 · 재실행 안전: (tenant_id,label) 충돌 시 정렬/활성만 갱신) ──
insert into public.location_vocab (tenant_id, code, label, sort_order)
select t.id, v.label, v.label, v.ord
from public.tenants t
cross join (values
  ('향정금고 S-1', 1),
  ('조제실 A-1',  2),
  ('조제실 B-1',  3),
  ('조제실 T-2',  4),
  ('조제실 T-1',  5),
  ('냉장고 R-2',  6),
  ('냉장고 R-1',  7),
  ('조제실 A-2',  8),
  ('주사제 J-1',  9),
  ('수액제 F-1', 10),
  ('수액제 F-2', 11),
  ('수액제 F-3', 12),
  ('재고 D-1',   13),
  ('재고 D-2',   14),
  ('재고 D-3',   15)
) as v(label, ord)
on conflict (tenant_id, label) do update
  set sort_order = excluded.sort_order, is_active = true;

-- ── RLS (0001 패턴: tenant_id in current_tenant_ids()) ──
alter table public.location_vocab enable row level security;

drop policy if exists location_vocab_sel on public.location_vocab;
create policy location_vocab_sel on public.location_vocab
  for select using (tenant_id in (select public.current_tenant_ids()));
drop policy if exists location_vocab_ins on public.location_vocab;
create policy location_vocab_ins on public.location_vocab
  for insert with check (tenant_id in (select public.current_tenant_ids()));
drop policy if exists location_vocab_upd on public.location_vocab;
create policy location_vocab_upd on public.location_vocab
  for update using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));
drop policy if exists location_vocab_del on public.location_vocab;
create policy location_vocab_del on public.location_vocab
  for delete using (tenant_id in (select public.current_tenant_ids()));

-- ── GRANT (authenticated — RLS가 행 범위 통제) ──
grant select, insert, update, delete on public.location_vocab to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 검증 SELECT (commit 후 별도 실행)
--   select tenant_id, count(*) from public.location_vocab group by tenant_id;  -- 테넌트당 15
--   select relrowsecurity from pg_class where relname='location_vocab';        -- t
--   select policyname, cmd from pg_policies where tablename='location_vocab';  -- 4건
-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
--   drop table if exists public.location_vocab cascade;
-- ════════════════════════════════════════════════════════════════