-- 0064_atc_cassette_slots.sql
-- 목적: ATC 자동조제기(Autopack) 카세트 배치 관리용 컬럼 4개 신설(A안 — fsp_slot 별도 컬럼).
--   · atc_slot      text NULL   — 카세트/확장 슬롯 '1'~'80' · '301'~'308'
--   · fsp_slot      text NULL   — FSP 고정식 'FSP1'~'FSP5'
--   · lasa_type     text NULL   — 유사약품 '모양' · '용량' · '발음'
--   · storage_light boolean default false — 차광 여부
--   · 한 약이 카세트+FSP 양쪽 배정 가능(예: SBCLP1 = atc_slot '35' + fsp_slot 'FSP4').
--   · UNIQUE(tenant_id, atc_slot) / (tenant_id, fsp_slot) 부분 인덱스 — 한 슬롯 1약품(구역별).
--   · 기존 값·정본·스냅샷 무관. dryrun(BEGIN/ROLLBACK) A~F 후 apply.

alter table public.drugs
  add column if not exists atc_slot      text,
  add column if not exists fsp_slot      text,
  add column if not exists lasa_type     text,
  add column if not exists storage_light boolean not null default false;

create unique index if not exists drugs_tenant_atc_slot_key
  on public.drugs (tenant_id, atc_slot) where atc_slot is not null;
create unique index if not exists drugs_tenant_fsp_slot_key
  on public.drugs (tenant_id, fsp_slot) where fsp_slot is not null;

-- 롤백(참고):
-- drop index if exists public.drugs_tenant_atc_slot_key;
-- drop index if exists public.drugs_tenant_fsp_slot_key;
-- alter table public.drugs drop column if exists atc_slot, drop column if exists fsp_slot,
--   drop column if exists lasa_type, drop column if exists storage_light;