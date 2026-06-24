# 단가 변경 감사추적(0020) — drug_price_history (2026-06-23)

> 브랜치 feat/price-audit. 백엔드만(테이블·트리거), 클라 무변경. 기록까지(화면 표시 보류·Q3).

## Task1 — 스키마·RLS
- `drug_price_history(id, tenant_id, drug_code, field, old_price, new_price, changed_by, changed_at, source)` + index(tenant_id, drug_code, changed_at desc).
- RLS: **SELECT 자기 테넌트만**(`tenant_id in current_tenant_ids()`). INSERT/UPDATE/DELETE 정책 없음 → 일반 사용자 직접쓰기 불가, **트리거(SECURITY DEFINER)만 INSERT**.

## Task2 — AFTER UPDATE 트리거
- `log_drug_price_change()` AFTER UPDATE on drugs(SECURITY DEFINER): **purchase_price가 `is distinct from` OLD일 때만** old/new·auth.uid()·now() 기록. (edi_price/price_unit 보류·Q2). 무변경 UPDATE는 미기록(노이즈 방지).
- 실행 순서: BEFORE(0019 권한강제) → UPDATE → AFTER(0020 기록) → 0019 통과분만 commit·기록.

## Task3 — 우회 점검(커버리지)
| 경로 | 단가변경 시 |
|---|---|
| EditModal(378)·인라인단가(738)·재고인라인(798)·메모(805)·일괄(866) | 전부 `drugs.update`(authenticated) → BEFORE/AFTER 트리거 발동 → **빠짐없이 캡처** |
| service_role | 트리거는 role 무관 발동. 단 0019가 auth.uid()=null→owner/admin 아님→**차단** → 단가변경 자체 불가 |
| ⚠ 유일 우회 | `session_replication_role=replica`(트리거 비활성)은 **슈퍼유저 전용**(앱 경로 아님). Management API 관리작업만 해당 |
→ 앱의 모든 단가 변경 경로는 0019(권한)+0020(기록) 이중 커버.

## Task4 — 화면 이력(제안만, 미적용)
- 약품 360°/EditModal에 '단가 변경 이력' 읽기 탭(drug_price_history SELECT, 자기 테넌트). **월별 조회·보고서 트랙 후** 별도 적용.

## Task5 — 검증(가역 ROLLBACK)
| # | 시나리오 | 결과 |
|---|---|---|
| 1 | owner 단가 198→199 | history **1행**(old 198·new 199·by owner·field purchase_price) ✓ |
| 2 | member 단가 변경 | 0019 **차단** → 미기록 ✓ |
| 3 | 무변경(198→198) | **미기록**(0행) ✓ |
| 4 | member 비단가(memo) | UPDATE OK·history 0·**current_qty 무영향** ✓ |
| 5 | 영구 상태 | drug_price_history total=0(전부 ROLLBACK) ✓ |
- 게이트: build ✓ · lint 103e/8w(회귀 0·클라 무변경) · 비밀 0 · 운영 데이터 무변경.

## 롤백
- `drop trigger trg_log_drug_price_change` · `drop function log_drug_price_change` · `drop table drug_price_history`.