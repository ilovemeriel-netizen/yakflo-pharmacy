-- 0065_atc_pinned_and_swap.sql
-- 목적: ATC 상비약 슬롯 고정(atc_pinned) + 상비 3건 슬롯 1·2·3 집중 교환 2쌍.
--   · atc_pinned boolean default false 추가.
--   · 슬롯 교환: SANTLTRPL 46→1, TRST 1→46 / STCNE 307→2, CTRC75 2→307.
--     UNIQUE(tenant_id,atc_slot) 위반 방지 위해 임시 NULL 경유(단계별 UPDATE).
--   · atc_pinned=true: SANTLTRPL(1)·STCNE(2)·AMNP5(3). AMNP5는 슬롯 3 현행 유지.
--   · 단일 운영 tenant 전제(drug_code 기준). dryrun(BEGIN/ROLLBACK) 후 apply.
alter table public.drugs add column if not exists atc_pinned boolean not null default false;
update public.drugs set atc_slot = null where drug_code in ('SANTLTRPL','TRST','STCNE','CTRC75');
update public.drugs set atc_slot = '1'   where drug_code = 'SANTLTRPL';
update public.drugs set atc_slot = '46'  where drug_code = 'TRST';
update public.drugs set atc_slot = '2'   where drug_code = 'STCNE';
update public.drugs set atc_slot = '307' where drug_code = 'CTRC75';
update public.drugs set atc_pinned = true where drug_code in ('SANTLTRPL','STCNE','AMNP5');
-- 롤백(참고): 역교환(1→46,46→1,2→307,307→2) + atc_pinned=false + drop column atc_pinned;
