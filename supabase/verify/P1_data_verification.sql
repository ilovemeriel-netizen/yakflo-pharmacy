-- ════════════════════════════════════════════════════════════════
-- Yakflo · 기초데이터 P1 검증 SELECT 모음 (읽기 전용 · 변경 없음)
-- 실행 위치: Supabase Dashboard → SQL Editor (각 쿼리 개별 실행)
--
-- 목적: 런북 P1-2/3/4 + 통합가이드 §8(검증 발견)·§11-1(0단계 마일스톤)을
--       라이브 drugs 데이터에 대해 측정한다. 결과를 기대값과 대조해
--       P1-3(보강) 백로그를 확정한다.
--
-- ⚠️ 이 파일은 SELECT만 포함한다. INSERT/UPDATE/DELETE/DDL 없음.
-- ⚠️ 기대값은 통합가이드가 원천 yakflo_data(1,103행) 기준으로 제시한 값.
--    현 라이브 drugs는 1083행(0002 캡처)이라 일부 축은 차이가 정상일 수 있다.
--    (전문/일반·확인필요 등은 아직 컬럼 미보강 → NULL/부재가 정상. P1-3 대상)
-- ════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
-- [P1-2 / 0단계] 0. 총 행수 — 원천 적재 규모 확인
--   기대: 통합가이드 1,103 / 0002 캡처 1083 — 격차 확인(재적재본 여부)
-- ────────────────────────────────────────────────────────────────
select count(*) as drugs_total from public.drugs;


-- ────────────────────────────────────────────────────────────────
-- [P1-2 / 0단계 ①] 1. 구분(category) 분포 — 6종 100% 매핑 확인
--   기대 분포(가이드 P1-2): 경구 802·주사 137·인용(?) 130·외용 18·영양 13·의약외품 3 = 1,103
--   ※ '인용 130'은 원천 라벨 디코딩이 모호 — 실제 값과 대조해 확정할 것
--   게이트: drug_vocab(axis='category') 외 값 = 0 이어야 100% 매핑
-- ────────────────────────────────────────────────────────────────
select coalesce(category,'(NULL)') as category, count(*) as cnt
from public.drugs
group by category
order by cnt desc;

--   [1-b] 통제 어휘 밖(미분류) category 건수 → 0 이어야 정상
select count(*) as category_unmapped
from public.drugs d
where d.category is null
   or not exists (
     select 1 from public.drug_vocab v
     where v.axis='category' and v.code = d.category);


-- ────────────────────────────────────────────────────────────────
-- [0단계 ②][§8] 2. 규제(마약구분) 분포 — 현 스키마 is_narcotic + narcotic_type
--   가이드 §8 원천 기대: 일반 857·확인필요 225·향정 13·한외마약 5·마약 3
--   현 스키마는 '확인필요'/'한외마약' 값을 저장하지 않음 → P1-3 보강 대상 식별용
-- ────────────────────────────────────────────────────────────────
select
  case when coalesce(is_narcotic,false)=false then '일반(is_narcotic=false)'
       else coalesce(narcotic_type,'(narcotic_type NULL)') end as narcotic_class,
  count(*) as cnt
from public.drugs
group by 1
order by cnt desc;


-- ────────────────────────────────────────────────────────────────
-- [§8] 3. 전문/일반(prescription_type) 분포 — 0006에서 신규 추가(아직 미보강)
--   가이드 §8 원천 기대: 전문 769·확인필요 225·일반 103·약국외판매 3·건기식 1·의료 1·전문(희귀) 1
--   현재 전부 NULL이 정상(P1-3 보강 후 재측정). 컬럼 존재만 확인.
-- ────────────────────────────────────────────────────────────────
select coalesce(prescription_type,'(NULL · 미보강)') as prescription_type, count(*) as cnt
from public.drugs
group by prescription_type
order by cnt desc;


-- ────────────────────────────────────────────────────────────────
-- [§8] 4. 보관방법(storage_method) 분포 — 빈값 483건 보강 대상 식별
--   가이드 §8 원천 기대: 빈값 483·실온 459·실온/차광 134·냉장/차광 14·냉장 13
--   게이트(P1-3): 빈값(NULL/'') 건수를 0으로 보강
-- ────────────────────────────────────────────────────────────────
select coalesce(nullif(trim(storage_method),''),'(빈값)') as storage_method, count(*) as cnt
from public.drugs
group by 1
order by cnt desc;

--   [4-b] 보관방법 빈값 건수 → P1-3 보강 목표 0
select count(*) as storage_blank
from public.drugs
where storage_method is null or trim(storage_method)='';


-- ────────────────────────────────────────────────────────────────
-- [0단계 ④][§7] 5. 상태(status) 3종 분포
--   가이드 §7/§11-1 기대: 사용 517·중지 578·해면 8 (합 1,103)
--   게이트: status ∈ {사용,중지,해면} 외 값 = 0
-- ────────────────────────────────────────────────────────────────
select coalesce(status,'(NULL)') as status, count(*) as cnt
from public.drugs
group by status
order by cnt desc;

--   [5-b] 상태 통제 어휘 밖 건수 → 0 이어야 정상
select count(*) as status_unmapped
from public.drugs d
where d.status is null
   or not exists (
     select 1 from public.drug_vocab v
     where v.axis='status' and v.code = d.status);


-- ────────────────────────────────────────────────────────────────
-- [§6-3 / 0단계 ③] 6. 파생 금액 미저장 검증
--   원칙: 금액(수량×단가)·재고금액은 저장하지 않고 조회 시 계산.
--   drugs에 단가(price_unit·insurance_price)만 있고 '금액/총액' 컬럼이 없어야 정상.
-- ────────────────────────────────────────────────────────────────
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='drugs'
  and (column_name ilike '%amount%' or column_name ilike '%금액%'
       or column_name ilike '%total%' or column_name ilike '%재고금액%');
--   기대: 0행 (파생 금액 컬럼 없음)


-- ────────────────────────────────────────────────────────────────
-- [P1-4] 7. 마스터/이관/파생 분리 적재 검증 — 4개 운영 테이블 행수
--   drugs(마스터) · inventory_stock(현재고) · transactions(거래) · monthly_snapshots(이월)
--   0002 캡처: drugs=1083 · inventory_stock=574 · monthly_snapshots=1422
-- ────────────────────────────────────────────────────────────────
select 'drugs'             as table_name, count(*) as cnt from public.drugs
union all
select 'inventory_stock',   count(*) from public.inventory_stock
union all
select 'transactions',      count(*) from public.transactions
union all
select 'monthly_snapshots', count(*) from public.monthly_snapshots;


-- ────────────────────────────────────────────────────────────────
-- [P1-4] 8. 코드 조인 무결성 — 이관 테이블의 drug_code가 마스터에 존재하는지
--   FK 0건 환경(가이드 §1-2)이므로 코드 조인만으로 묶임 → 고아 코드 0 이어야 정상
-- ────────────────────────────────────────────────────────────────
select 'inventory_stock' as src, count(*) as orphan_codes
from public.inventory_stock s
where not exists (select 1 from public.drugs d where d.drug_code = s.drug_code)
union all
select 'transactions', count(*)
from public.transactions t
where not exists (select 1 from public.drugs d where d.drug_code = t.drug_code);
--   기대: 양쪽 0


-- ════════════════════════════════════════════════════════════════
-- 결과 해석 가이드
--   · 1·5 게이트(미분류 0) 미통과 → 해당 값을 drug_vocab로 정규화(P1-3)
--   · 2·3·4 분포가 §8 기대와 차이 → '확인필요 225건' + '보관방법 483건'이
--     P1-3 보강 백로그. 보강 후 compound_type/prescription_type 백필.
--   · 0 총행수가 1103이 아니면 원천 재적재본 여부를 먼저 확정(P1-2)
--   · 8 고아 코드 > 0 → 이관/마스터 분리 적재 불일치 → 우선 조사
-- ════════════════════════════════════════════════════════════════
