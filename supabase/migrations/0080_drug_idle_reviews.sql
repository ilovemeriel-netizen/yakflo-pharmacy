-- 0080_drug_idle_reviews.sql
-- 목적: 「사용 점검」 화면용 이력 테이블 — 장기 미사용 약품의 보유 여부 판단을 누적 기록.
--   · 참고 모델: drug_change_plans(0038~0040) 구조 복제(운영 테이블 tenant 격리 규약·0076 이후).
--   · 이력 누적: 같은 drug_code에 여러 행이 쌓임. 현재 상태 = drug_code별 (reviewed_at DESC, created_at DESC) 최신 행.
--   · last_used_date·last_used_dept는 drugs 기존 컬럼 재사용 → 본 테이블에 두지 않음.
--   · drug_code는 drugs FK 아님(프로젝트 규약: 코드 기준 조인).
--   · dryrun 필수(BEGIN → 검증 → ROLLBACK). apply 미실행(승인 후 별도 적용).
--
-- [설계 판단]
--   · UNIQUE: 모델의 (tenant,code,base_date)를 답습하면 (tenant,drug_code,reviewed_at)이 되어 같은 날 재판단이 막힘
--     → 이력 누적 취지에 반하므로 비즈니스 UNIQUE 미부여(PK만). 중복 제거는 앱에서 판단.
--   · CHECK: 모델(plan_status)이 자유 select라 일관성 위해 status CHECK 미부여(앱 드롭다운 검증). 상태값 확장 유연.
--   · tenant_id NOT NULL: 모델은 nullable이나, BEFORE INSERT 트리거가 채운 뒤 NN 검사라 안전 + orphan 방지로 개선.

create table public.drug_idle_reviews (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  drug_code   text not null,                       -- drugs.drug_code 기준 조인(FK 아님)
  status      text not null,                       -- 관찰·중지·보유유지·해제 (앱 검증, CHECK 미부여)
  reviewed_at date not null default current_date,
  memo        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz default now()
);

-- 최신 상태 조회용 인덱스 (drug_code별 reviewed_at 최신 행)
create index drug_idle_reviews_tenant_code_reviewed_idx
  on public.drug_idle_reviews (tenant_id, drug_code, reviewed_at desc);

-- tenant_id 자동 부여(모델과 동일 공유 트리거)
create trigger trg_set_tenant_id
  before insert on public.drug_idle_reviews
  for each row execute function set_tenant_id_from_user();

-- 롤 권한: 앱은 authenticated로 접근(행 접근은 아래 RLS가 게이트).
--   ※ 모델(drug_change_plans)은 anon에도 CRUD가 있으나(Supabase 기본), anon은 current_tenant_ids가 비어 RLS로 전량 차단되므로
--     0080은 anon 미부여(0076 최소권한 취지·모델 대비 보안 개선, 기능 차이 없음). service_role/postgres는 소유자 권한으로 통과.
grant select, insert, update, delete on public.drug_idle_reviews to authenticated;

-- RLS: drug_change_plans 동일 패턴 4정책 (운영 테이블 = tenant_id + current_tenant_ids())
alter table public.drug_idle_reviews enable row level security;

create policy drug_idle_reviews_select_own_tenant on public.drug_idle_reviews
  for select using (tenant_id in (select current_tenant_ids()));

create policy drug_idle_reviews_insert_own_tenant on public.drug_idle_reviews
  for insert with check (tenant_id in (select current_tenant_ids()));

create policy drug_idle_reviews_update_own_tenant on public.drug_idle_reviews
  for update using (tenant_id in (select current_tenant_ids()))
              with check (tenant_id in (select current_tenant_ids()));

create policy drug_idle_reviews_delete_admin_own_tenant on public.drug_idle_reviews
  for delete using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.tenant_id = drug_idle_reviews.tenant_id
        and tm.role = any (array['owner','admin'])));

-- 롤백(참고): drop table if exists public.drug_idle_reviews cascade;
