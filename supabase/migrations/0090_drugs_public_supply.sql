-- 0090: 보건소·지자체 무상 공급 품목 표시 컬럼 신설 (drugs)
-- 배경: 보건소·지자체에서 무상 공급받는 품목(독감·폐렴 백신 등)은 구입단가 0이 정상이다.
--       단가 0을 결함으로 오인하거나 마감 모니터 C11(PRICE_ZERO_ACTIVE)이 오경보를 내는 것을 막을 표식이 필요하다.
-- 성격: 컬럼 추가 + 컬럼 주석. 초기 지정(UPDATE)은 하지 않는다 — 해당 품목은 사용자가 화면에서 직접 체크한다.
--       RLS·tenant_id·단가 컬럼 등 기존 구조 무변경. vaccine_accounts.funding_source 와는 독립 플래그다.
-- 적용: Supabase SQL Editor(운영 phgkjrvdtcdrdiuigici)에 붙여넣어 실행.

alter table public.drugs add column if not exists is_public_supply boolean not null default false;

comment on column public.drugs.is_public_supply is '보건소·지자체 무상 공급 품목. 단가 0이어도 정상';

-- 롤백: alter table public.drugs drop column if exists is_public_supply;
