-- =============================================================================
-- 0087_drug_barcodes.sql
-- 약플로 바코드 매핑 저장소 — 바코드 ↔ 약품
--
-- 목적
--   1) 스캐너(JS-6709UDI · HID 키보드 에뮬레이션)가 읽은 코드를 원내 약품에 연결
--   2) 심평원 「약가마스터_의약품표준코드」 적재분과 사람이 확정한 학습 매핑을 한 곳에
--   3) 포장단위별 1:N 을 담는다 — 약품 1건당 표준코드 평균 3.07개(실측)
--   4) GS1 이 아닌 자체 번호(소분 용기 · UDI 미부착 구재고 · 의약외품)도 수용
--
-- 원칙
--   * 이 마이그레이션은 테이블·함수·트리거·인덱스·RLS 만 만든다.
--     자료 적재는 scripts/apply_0087.mjs 가 한다(0083~0086 패턴).
--   * drugs · inventory_counts · inventory_count_items · 기존 트리거는 건드리지 않는다.
--   * src/ 는 이 PR 에서 무접촉이다. 스캔 로직·UI 는 별도 PR.
--
-- -----------------------------------------------------------------------------
-- ★ code 를 14자리로 정규화하는 이유 (2026-09-06 실측)
--   스캐너는 (01) 에 GTIN-14 를 낸다. 심평원 자료는 GTIN-13 이다.
--   GS1 표준은 GTIN-8/12/13/14 를 모두 14자리 필드에 우측 정렬하고 좌측을 0 으로 채운다.
--   좌측 0 부착은 체크디짓을 보존한다(실측 검증: 13자리 유효 → 14자리도 유효).
--
--   ★ 반대로 앞 1자리를 떼는 것은 성립하지 않는다.
--     지시자(GTIN-14 앞 1자리)가 0 이 아니면 체크디짓이 재계산되기 때문이다.
--       지시자 0 → 08806717068539 → 절단 8806717068539  = 원본 O
--       지시자 1 → 18806717068536 → 절단 8806717068536 ≠ 원본 X
--     14 → 13 파생은 조건부지만 13 → 14 부착은 언제나 안전하다.
--     소실이 없는 쪽을 저장 원본으로 잡는다.
--
-- ★ 포장 구분은 지시자가 아니라 13자리 본체에 있다 (실측)
--   스캔룩스300주사액: 품목기준코드 201202765 하나에 표준코드 7개가 붙고
--   12번째 자리가 용량(50·100·200·500·150·75·125 mL)을 가른다. 지시자는 전부 0.
--   → 13자리로 통합해도 포장별 행은 줄지 않는다. 통합의 이득이 없다.
--
-- ★ 매칭 경로는 제품코드(개정후) = drugs.insurance_code 완전일치 하나뿐이다.
--   품목기준코드 보완(사용중 52건)은 적재하지 않는다 — 3건이 다른 제품을 가리킨다:
--     SJLRZP4 삼진로라제팜주1mL → CSV 「아티반주사(로라제팜)」
--     VASELLIN 그린백색바셀린   → CSV 「구미백색바셀린(원료)」
--     D0562  큐앤큐바셀린윤나거즈 → 후보 114건
--   보완 경로는 화면에서 후보 제시용으로만 쓰고, 확정은 사람이 한다.
--
-- ★ is_rep — 대표행(대표코드 == 표준코드)은 포장 실체가 없다.
--   실측: 사용중 매칭분 1,424개 중 대표행 329개(23.1%)가
--   포장형태 100% 빈칸 · 제품총수량 100% 0.
--   이 플래그가 없으면 pack_type·pack_qty 결측을 적재 오류로 오인한다.
--
-- ★ pack_qty — drugs.current_qty 는 최소 단위(정·백) 개수이고
--   drugs.unit 은 포장 라벨이다. BTGR50 은 current_qty 676 = 676정(676병 아님.
--   purchase_price 381 / price_unit 38,100 = 100정/병 실측).
--   따라서 병(총수량 100) 1회 스캔 = 100정이 되어야 한다.
--   ※ 자동 곱셈은 하지 않는다 — 개봉된 병은 낱알을 세야 한다. 제안 표시용이다.
--
-- ★ drug_code 는 nullable 이다.
--   (1) 학습 매핑 중 「바코드는 읽었으나 약품 미확정」 상태를 담는다.
--   (2) 훗날 원내 미취급 약품까지 넓힐 때 스키마를 다시 만들지 않는다.
--   대신 insurance_code · product_name 을 함께 보관해 나중에 자동 연결이 가능하게 한다.
--
-- ★ 체크디짓을 CHECK 제약으로 걸지 않는 이유 (실측 근거)
--   심평원 자료 305,522건을 전수 검증한 결과 1건이 체크디짓 불일치다:
--     8806428006706 바이락스정(아시클로버) · 제품코드 642800670 (원내 미취급)
--   자료 제공자의 오류를 우리 제약이 막으면 월 갱신 배치가 통째로 실패한다.
--   검증 함수 gtin_check_ok() 는 만들어 두되 제약으로 걸지 않는다 — 화면 경고용이다.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 정규화 정본 — 저장 경로가 어디든 이 함수 하나를 통과한다
--    ★ normDrugCode 와 같은 이유로 단일 지점에 둔다. 호출부마다 규칙을 두면 갈린다.
--      다만 normDrugCode 는 JS 라 경로마다 호출해야 했던 반면,
--      이것은 트리거가 강제하므로 우회 자체가 불가능하다.
-- -----------------------------------------------------------------------------
create or replace function public.norm_barcode(v text, p_type text)
  returns text
  language plpgsql
  immutable
as $fn$
declare d text;
begin
  if v is null then return null; end if;

  if p_type = '자체' then
    -- 자체 번호는 손대지 않는다. 앞뒤 공백만 정리한다.
    d := btrim(v);
    if d = '' then return null; end if;
    return d;
  end if;

  if p_type = 'GS1' then
    -- (01) 접두는 AI 이므로 숫자에 섞지 않는다.
    --   ★ 단순히 숫자만 남기면 「(01)08806717068539」가 16자리가 된다(01 이 섞임).
    if v ~ '^\s*\(01\)' then
      d := (regexp_match(v, '^\s*\(01\)\s*([0-9]{14})'))[1];
      if d is null then return null; end if;   -- (01) 뒤가 14자리가 아니면 규격 밖
    else
      d := regexp_replace(v, '[^0-9]', '', 'g');
    end if;
    -- GS1 표준 길이만 허용한다. 그 외는 오타로 보고 거부한다(트리거가 예외를 던진다).
    --   ※ 9·10·11자리를 lpad 로 메우면 존재하지 않는 코드가 조용히 저장된다.
    if length(d) not in (8, 12, 13, 14) then return null; end if;
    return lpad(d, 14, '0');
  end if;

  return null;   -- 알 수 없는 code_type
end $fn$;

comment on function public.norm_barcode(text, text) is
  'GS1/자체 바코드 정규화 정본. GS1 은 (01) 접두 제거 후 14자리 좌측 0 채움(허용 길이 8·12·13·14), 자체는 btrim.';

-- 체크디짓 검증 — ★ 제약이 아니라 경고용. 헤더의 「걸지 않는 이유」 참조.
create or replace function public.gtin_check_ok(g text)
  returns boolean
  language plpgsql
  immutable
as $fn$
declare s int := 0; i int; n int; w int;
begin
  if g is null or g !~ '^[0-9]{8,14}$' then return false; end if;
  -- 오른쪽 끝(체크디짓) 바로 앞부터 왼쪽으로 가중치 3,1,3,1...
  for i in 1 .. length(g) - 1 loop
    n := substr(g, length(g) - i, 1)::int;
    w := case when i % 2 = 1 then 3 else 1 end;
    s := s + n * w;
  end loop;
  return ((10 - s % 10) % 10) = substr(g, length(g), 1)::int;
end $fn$;

comment on function public.gtin_check_ok(text) is
  'GS1 체크디짓 검증. 제약으로 쓰지 말 것 — 심평원 자료에 불일치 1건 실재(8806428006706).';

-- -----------------------------------------------------------------------------
-- 2. 테이블
-- -----------------------------------------------------------------------------
create table if not exists public.drug_barcodes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  code            text not null,                 -- 정규화 후 저장(트리거가 강제)
  code_type       text not null,                 -- 'GS1' | '자체'
  drug_code       text,                          -- nullable: 헤더 참조
  insurance_code  text,                          -- CSV 제품코드(개정후) 원문
  product_name    text,                          -- CSV 한글상품명
  pack_type       text,                          -- CSV 포장형태 원문(병·PTP·앰플·Vial 등)
  pack_qty        numeric,                       -- CSV 제품총수량(최소단위 개수)
  is_rep          boolean not null default false,
  source          text not null,                 -- '심평원' | '학습'
  std_version     text,                          -- 적재 자료 기준일 '2025-10-31'
  memo            text,
  is_active       boolean not null default true,
  created_at      timestamptz default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz
);

comment on table  public.drug_barcodes                 is '바코드 ↔ 약품 매핑. 심평원 적재분과 학습 매핑분을 source 로 구분한다.';
comment on column public.drug_barcodes.code            is 'GS1 은 14자리 숫자, 자체는 임의 문자열. 저장 전 norm_barcode() 가 정규화한다.';
comment on column public.drug_barcodes.code_type       is 'GS1 = 표준 바코드 / 자체 = 원내 발행 번호(소분 용기·UDI 미부착 구재고).';
comment on column public.drug_barcodes.drug_code       is 'nullable — 미확정 매핑과 향후 미취급 약품 확장을 위해.';
comment on column public.drug_barcodes.is_rep          is '대표행(대표코드==표준코드). true 면 pack_type·pack_qty 가 NULL 인 것이 정상.';
comment on column public.drug_barcodes.pack_qty        is '포장당 최소단위 개수. drugs.current_qty 와 같은 단위. 자동 곱셈 금지, 제안용.';
comment on column public.drug_barcodes.source          is '심평원 = 배치 적재(재적재 대상) / 학습 = 사람 확정(재적재가 건드리지 않음).';

-- -----------------------------------------------------------------------------
-- 3. 제약 — code_type 별 형식 분기
-- -----------------------------------------------------------------------------
alter table public.drug_barcodes drop constraint if exists drug_barcodes_code_type_valid;
alter table public.drug_barcodes add  constraint drug_barcodes_code_type_valid
  check (code_type in ('GS1', '자체'));

alter table public.drug_barcodes drop constraint if exists drug_barcodes_code_format;
alter table public.drug_barcodes add  constraint drug_barcodes_code_format
  check (
    case code_type
      when 'GS1'  then code ~ '^[0-9]{14}$'
      when '자체' then length(btrim(code)) between 1 and 64
      else false
    end
  );

alter table public.drug_barcodes drop constraint if exists drug_barcodes_source_valid;
alter table public.drug_barcodes add  constraint drug_barcodes_source_valid
  check (source in ('심평원', '학습'));

-- ★ 대표행은 포장 실체가 없다 — 값이 들어오면 적재 오류다.
alter table public.drug_barcodes drop constraint if exists drug_barcodes_rep_no_pack;
alter table public.drug_barcodes add  constraint drug_barcodes_rep_no_pack
  check (not is_rep or (pack_type is null and pack_qty is null));

-- -----------------------------------------------------------------------------
-- 4. 트리거 — 정규화 강제 + updated_at
-- -----------------------------------------------------------------------------
create or replace function public.trg_drug_barcodes_norm()
  returns trigger
  language plpgsql
as $fn$
declare n text;
begin
  n := public.norm_barcode(new.code, new.code_type);
  -- ★ 조용히 고치지 않는다. 규격 밖이면 거부하고 사유를 말한다.
  --   errcode 23514 = check_violation. 기존 dbErrorMsg·bulkFailKind 매핑을
  --   손대지 않고도 화면에 사유가 뜬다(보호 계통 무접촉).
  if n is null then
    raise exception '바코드 번호 형식이 올바르지 않습니다 (입력: %, 종류: %)', new.code, new.code_type
      using errcode = '23514';
  end if;
  new.code := n;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $fn$;

drop trigger if exists drug_barcodes_norm on public.drug_barcodes;
create trigger drug_barcodes_norm
  before insert or update on public.drug_barcodes
  for each row execute function public.trg_drug_barcodes_norm();

-- -----------------------------------------------------------------------------
-- 5. 인덱스
--    ★ 한 바코드는 한 약품. 실측 근거: 심평원 자료 305,522행 전량 고유이며
--      표준코드 ↔ 제품코드가 1:1(한 표준코드에 제품코드 2개 이상 = 0건).
--      비활성 행은 이력으로 남으므로 부분 인덱스로 둔다.
--    ★ code_type 을 유일 키에 넣지 않는다 — 자체 번호가 우연히 GS1 과 같은 값이면
--      스캔 시 어느 쪽인지 가릴 수 없다. 값 자체로 유일해야 한다.
-- -----------------------------------------------------------------------------
drop   index if exists public.drug_barcodes_code_uniq;
create unique index drug_barcodes_code_uniq
  on public.drug_barcodes (tenant_id, code) where is_active;

create index if not exists drug_barcodes_drug_code_idx
  on public.drug_barcodes (tenant_id, drug_code) where is_active;

create index if not exists drug_barcodes_insurance_code_idx
  on public.drug_barcodes (tenant_id, insurance_code) where is_active;

-- -----------------------------------------------------------------------------
-- 6. RLS — 0085 inventory_counts 4정책 패턴과 동일. 삭제만 admin.
-- -----------------------------------------------------------------------------
alter table public.drug_barcodes enable row level security;

drop policy if exists drug_barcodes_select_own_tenant on public.drug_barcodes;
create policy drug_barcodes_select_own_tenant on public.drug_barcodes
  for select using (tenant_id in (select current_tenant_ids()));

drop policy if exists drug_barcodes_insert_own_tenant on public.drug_barcodes;
create policy drug_barcodes_insert_own_tenant on public.drug_barcodes
  for insert with check (tenant_id in (select current_tenant_ids()));

drop policy if exists drug_barcodes_update_own_tenant on public.drug_barcodes;
create policy drug_barcodes_update_own_tenant on public.drug_barcodes
  for update using      (tenant_id in (select current_tenant_ids()))
              with check (tenant_id in (select current_tenant_ids()));

-- ★ 삭제는 admin 한정 — 매핑 회수는 is_active=false 가 정규 경로다.
--   과거 실사 항목이 그 코드로 담겼을 수 있어 물리 삭제는 이력을 끊는다.
drop policy if exists drug_barcodes_delete_admin_own_tenant on public.drug_barcodes;
create policy drug_barcodes_delete_admin_own_tenant on public.drug_barcodes
  for delete using (tenant_id in (select current_tenant_ids()) and public.is_admin());

commit;

-- 롤백(참고):
-- drop trigger  if exists drug_barcodes_norm on public.drug_barcodes;
-- drop policy   if exists drug_barcodes_delete_admin_own_tenant on public.drug_barcodes;
-- drop policy   if exists drug_barcodes_update_own_tenant       on public.drug_barcodes;
-- drop policy   if exists drug_barcodes_insert_own_tenant       on public.drug_barcodes;
-- drop policy   if exists drug_barcodes_select_own_tenant       on public.drug_barcodes;
-- drop table    if exists public.drug_barcodes;
-- drop function if exists public.trg_drug_barcodes_norm();
-- drop function if exists public.gtin_check_ok(text);
-- drop function if exists public.norm_barcode(text, text);
