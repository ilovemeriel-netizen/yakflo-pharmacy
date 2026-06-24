-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0021 drugs 단가 컬럼 의미 COMMENT — 가역 (회귀 방지·문서화)
-- 실행: Supabase Management API 또는 psql. COMMENT는 데이터/구조 무변경(메타데이터만).
--
-- 배경: 2026-06 금액 100배 회귀 — 거래·월마감 코드가 금액 계산에 price_unit(통당단가)을
--   참조(올바른 건 purchase_price=구입단가). 스키마 차원에서 의미를 박아 재발 방지.
-- ▶ 금액 계산(재고금액·거래금액·월마감)은 항상 purchase_price. price_unit은 표시용.
-- ════════════════════════════════════════════════════════════════

comment on column public.drugs.purchase_price is
  '구입단가(개당) — 약품 1개당 실제 구입가. 재고/거래/월마감 등 모든 금액 계산의 유일한 기준. 예: 가바로닌캡슐100mg=198';
comment on column public.drugs.price_unit is
  '통당단가 — 포장(통/병) 단위 가격(=구입단가×포장수량). 표시용. 금액 계산에 사용 금지. 예: 19800=198×100';
comment on column public.drugs.edi_price is
  '보험약가 — 보험 상환가(이력/참고용). 구입단가와 무관(구입가가 보험약가보다 높을 수 있음).';

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향) — 코멘트 제거
-- comment on column public.drugs.purchase_price is null;
-- comment on column public.drugs.price_unit is null;
-- comment on column public.drugs.edi_price is null;
-- ════════════════════════════════════════════════════════════════