-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0042 drug_master 약가 컬럼 정밀도 무제한 확장 — 가역(주의: 아래 참조)
-- 실행: Supabase SQL Editor / Management API (운영 phgkjrvdtcdrdiuigici).
--
-- 배경: 0041 적용 후 적재 리허설에서 edi_price numeric(10,2)(정수부 8자리 한도,
--   최대 99,999,999) 오버플로로 UPSERT 실패. 원인은 데이터 오류가 아니라
--   초고가 유전자·세포치료제의 실재 보험약가가 1억을 초과하기 때문:
--     · 졸겐스마주(오나셈노진아베파르보벡)  1,981,726,933원 (~20억)
--     · 킴리아주(티사젠렉류셀)               360,039,359원
--     · 럭스터나주(보레티진네파보벡)         325,800,000원
-- 변경: edi_price·max_price 를 정밀도 무제한 numeric 으로 확장하여 원값을 절단 없이 보존.
--   (0041 이 strength·total_qty 를 무제한 numeric 으로 만든 것과 일관)
-- 무변경: 다른 컬럼·제약·권한·RLS·기존 데이터.
-- ════════════════════════════════════════════════════════════════

alter table public.drug_master alter column edi_price type numeric;
alter table public.drug_master alter column max_price type numeric;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
--   ⚠ 주의: 축소 롤백은 기존 값이 numeric(10,2) 범위를 벗어나면 실패한다
--   (적재 후에는 1억 초과 행 3건 때문에 롤백 불가 — 원본 보존이 목적이므로 정상).
-- alter table public.drug_master alter column edi_price type numeric(10,2);
-- alter table public.drug_master alter column max_price type numeric(10,2);
-- ════════════════════════════════════════════════════════════════