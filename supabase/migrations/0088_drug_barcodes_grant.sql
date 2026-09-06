-- =============================================================================
-- 0088_drug_barcodes_grant.sql
-- drug_barcodes 테이블 권한 부여 — 0087 누락분 보정
--
-- 무엇이 잘못됐나
--   0087 은 RLS 를 켜고 정책 4개를 만들었지만 **GRANT 를 빠뜨렸다.**
--   RLS 정책은 GRANT 가 선행되어야 동작한다 — 권한이 없으면 정책을 보기도 전에
--   `42501 permission denied for table drug_barcodes` 로 막힌다.
--   브라우저(authenticated 롤)에서 스캔 조회가 통째로 실패했다.
--
--   실측(2026-09-06):
--     drug_barcodes 의 GRANT 는 postgres 뿐. authenticated·service_role **0건**.
--     set local role authenticated → select count(*) from drug_barcodes
--       → 42501 permission denied           ★ 재현됨
--     같은 조건에서 inventory_counts·inventory_count_items·drugs·drug_master 는 정상.
--     함수 EXECUTE(gtin_check_ok·norm_barcode)는 PUBLIC 기본값으로 이미 정상.
--
-- 왜 verify 가 놓쳤나
--   verify_0087.mjs 가 DATABASE_URL(postgres 소유자)로 접속한다. 소유자는 RLS 와
--   GRANT 를 모두 우회하므로 11/11 통과가 **실제 사용 경로를 검증하지 못했다.**
--   → verify_0088.mjs 에는 `set local role authenticated` 조회를 필수로 넣는다.
--     RLS 테이블을 새로 만들 때마다 이 검증을 넣을 것(결함 72).
--
-- 왜 0087 을 고치지 않나
--   이미 운영에 적용된 마이그레이션이다. 기존 파일 수정 금지 규약에 따라
--   신규 번호로만 보정한다.
--
-- 권한 범위 — 0085 inventory_counts 패턴을 그대로 따른다
--   · authenticated : select, insert, update, delete
--       (delete 는 RLS 정책 drug_barcodes_delete_admin_own_tenant 가 is_admin() 으로
--        다시 좁힌다. GRANT 는 문을 열고 RLS 가 대상을 고르는 2단 구조다.)
--   · service_role  : 같은 4종 (배치 적재 apply_0087 이 쓴다)
--   · anon          : **주지 않는다.** 로그인 없이 볼 자료가 아니다.
--                     0085·0083 도 anon 에 주지 않았다. drugs·drug_lots 의 anon 권한은
--                     구 마이그레이션의 잔재이며 새 테이블이 따를 패턴이 아니다.
--
-- ※ 시퀀스 GRANT 는 필요 없다 — id 가 uuid default gen_random_uuid() 다.
-- =============================================================================

begin;

grant select, insert, update, delete on public.drug_barcodes to authenticated;
grant select, insert, update, delete on public.drug_barcodes to service_role;

commit;

-- 롤백(참고):
-- revoke select, insert, update, delete on public.drug_barcodes from authenticated;
-- revoke select, insert, update, delete on public.drug_barcodes from service_role;
