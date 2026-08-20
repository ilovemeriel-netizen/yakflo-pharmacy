-- 0070_fsp5_note_clear.sql
-- 목적: FSP5(QROKEL125 큐로켈정12.5mg)는 0.5T 운용이 아님 → fsp_note 제거.
--   · UPDATE 1행. fsp_slot 배정(FSP5)은 유지, 표시용 fsp_note만 NULL.
--   · LSX(FSP2)·SBCLP1(FSP4)의 fsp_note '0.5T'는 유지.
--   · fsp_note는 monthly_snapshots·거래와 무관 컬럼 → 1~7월 정본 무변동.
--   · dryrun(BEGIN→UPDATE→검증→ROLLBACK) 통과 후 apply.

update public.drugs set fsp_note = null where drug_code = 'QROKEL125';

-- 롤백(참고): update public.drugs set fsp_note = '0.5T' where drug_code = 'QROKEL125';
