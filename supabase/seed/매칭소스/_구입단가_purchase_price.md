# 구입단가 정본화 — drugs.purchase_price 신설·백필 + 단가/재고금액 재지정 (2026-06-23)

> 브랜치 feat/purchase-price. 발단: 재고 총금액 4.7억(edi_price 기준)이 비정상 → edi_price가 개당 구입단가 아님 판명.

## 근본 원인
- `price_unit` = 통당단가, `edi_price` = **혼재**(가바로닌 198/407은 개당이나 ADLT 37,961·SALMARL1 111,376 등 125종은 통당/포장가). → drugs에 신뢰 가능한 개당 구입단가 컬럼 없음.
- 검증된 개당 구입단가 = monthly_snapshots 클린월(05→01) `closing_amount/closing_qty` (06월 보정 때 검증).
- 재고금액 비교: price_unit 12,240,039,418 ❌ · edi_price 470,909,580 ❌ · **클린월단가 111,989,387 ✅**(05마감 113,063,588과 일치).

## 조치 (가역)
1. **0018**: `drugs.purchase_price numeric` 컬럼 신설(Management API). 롤백=drop column.
2. **백필**(`backfill_purchase_price.mjs --commit`): 클린월 검증단가로 **616종** RLS UPDATE(purchase_price만). 단가없음 493종(스냅샷 미존재)은 null 유지. edi_price·current_qty·수량 무수정.
3. **재지정**(App.jsx): 단가 열·인라인 편집·재고총금액(totalAmt) 참조를 `edi_price`→**`purchase_price`**. edi_price 컬럼은 DB 보존(사용자 이력용). 통당단가(price_unit)는 '통당단가' 보조열 유지.

## 검증
| 항목 | 결과 |
|---|---|
| 재고 총금액 | **111,989,387(1.12억)** ✓ (=05마감 113M) |
| 단가 표시 | 가바로닌100=198·300=407·ADLT=**313**(edi 37,961 교정)·NS1=**1,065**(edi 0→채움) |
| 인라인 저장(ADLT 313→320) | purchase_price 변경 · **edi_price·current_qty 무변경 ✓** · 복원 ✓ |
| 게이트 | build ✓ · lint 103e/8w(회귀 0) · 비밀 0 |

## 롤백
- 0018 역방향: `alter table drugs drop column purchase_price` (백필값 함께 제거). 또는 `update drugs set purchase_price=null`.
- App.jsx: 본 커밋 revert(purchase_price→edi_price 환원).

## 비고
- purchase_price는 구입가 변동 시 약무팀이 약품목록 인라인으로 수정(owner/admin). 클린월 백필은 초기값.
- 단가없음 493종은 대부분 무재고/미사용(스냅샷 없음) — 재고금액 영향 0. 필요 시 약무팀이 입력.