-- 0071_atc_excluded.sql
-- 목적: ATC 자동조제기 수기 조제(배정 제외) 관리 — 약사가 특정 약품을 카세트 배정에서 수동 제외.
--   · atc_excluded       boolean not null default false — true면 사용량순 배정에서 건너뜀(향정·마약과 동일 취급)
--   · atc_exclude_reason text NULL — 제외 사유(수기 조제 필요·분할 조제·규격/카세트 없음·저빈도·기타 등)
--   · 순위 산정에는 포함(전체 기준 유지), 슬롯 배정만 제외. 제안 목록엔 「수기 조제」 배지+사유로 표시.
--   · 정본(monthly_snapshots)·거래 무관 — 컬럼 추가 DDL. dryrun(BEGIN→ALTER→검증→ROLLBACK) 통과 후 apply.

alter table public.drugs
  add column if not exists atc_excluded      boolean not null default false,
  add column if not exists atc_exclude_reason text;

-- 롤백(참고):
-- alter table public.drugs drop column if exists atc_excluded, drop column if exists atc_exclude_reason;
