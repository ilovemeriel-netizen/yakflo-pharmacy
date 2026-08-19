-- 0067_fsp_note.sql
-- 목적: FSP 0.5T 반알 자리 메모용 fsp_note 컬럼. 화면 상수 대신 데이터로 보유.
--   · fsp_note text NULL. 적재 3건: LSX(FSP2)·SBCLP1(FSP4)·QROKEL125(FSP5) = '0.5T'.
--   · 기존 값·정본 무관. dryrun 후 apply.
alter table public.drugs add column if not exists fsp_note text;
update public.drugs set fsp_note = '0.5T' where drug_code in ('LSX','SBCLP1','QROKEL125');
-- 롤백(참고): alter table public.drugs drop column if exists fsp_note;
