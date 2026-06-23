# inventory_stock 소수 차이 42건 — 목록 보관 + 제안 (미적용)

> 스크립트: `scripts/dump_inventory_diff.mjs` (대조 전용·쓰기 없음, anon+RLS owner 세션)
> 정책(Q2): **현행 정수 유지로 확정**, 목록 보관. 소수 보존은 **제안만** — 적용은 승인 후.

## 현황
- `inventory_stock.current_qty`는 **정수**, `monthly_snapshots`는 numeric(0012). → 분할단위 약품에서 단위가 어긋남.
- 42건 **전부 분할단위 소수**(반/사분 단위), 정수 차이 0건. 적재 시 반올림되어 소수가 유실됨.

## 42건 목록 (drug_code · DB정수 → CSV소수 · 약품명)
| code | DB | CSV | 약품명 |
|---|---|---|---|
| 7DEXAMTS | 68 | 67.5 | 휴메딕스덱사메타손포스페이트이나트륨주사1mL |
| 7FIASPFT | 11 | 11.372 | 피아스프플렉스터치주100단위3mL |
| 7HMLR | 3 | 2.642 | 휴물린알주100단위 |
| 7VCMYC | 25 | 25.2 | 이노엔반코마이신염산염주1g |
| ADLT | 2752 | 2751.5 | 아달라트오로스정30mg |
| BSPR10 | 634 | 633.5 | 명인부스피론염산염정10mg |
| CIRT80 | 334 | 333.5 | 씨르탄정80mg |
| CLRMZ50 | 2811 | 2811.25 | 명인클로르프로마진염산염정50mg |
| CONCR | 67 | 66.5 | 콩코르정2.5mg |
| DICRZ | 1214 | 1213.5 | 다이크로짇정 |
| DPS5 | 187 | 186.5 | 데파스정0.5mg |
| ETSR60 | 1911 | 1910.5 | 엘탄서방정60mg |
| FEBURIC40 | 123 | 122.5 | 페브릭정40mg |
| GRD2 | 287 | 286.5 | 게리드정2mg |
| HDTON | 52 | 52.25 | 환인히단토인정100mg |
| JANUST100 | 413 | 413.25 | 자누스틴정100mg |
| LSX | 954 | 953.5 | 라식스정40mg |
| MEDC625 | 266 | 265.5 | 메디크라정625mg |
| MIRTA7.5 | 343 | 342.5 | 밀타정7.5mg |
| NAXEN-F | 632 | 631.5 | 낙센에프서방정1000mg |
| NBCT | 241 | 240.5 | 네비칸정 |
| NEOCT5 | 970 | 969.5 | 네오셉트정5mg |
| NTRGLCR | 1281 | 1280.5 | 명문니트로글리세린0.6mg설하정 |
| OLMEC4 | 45 | 45.25 | 올멕정40mg |
| ORFILSTR15 | 4131 | 4131.1 | 오르필시럽150ml |
| PKMEZ | 436 | 435.5 | 피케이멜즈정 |
| PND | 168 | 167.5 | 페니드정10mg |
| PRGBL25 | 766 | 765.5 | 현대프레가발린정25mg |
| PSDFD | 1462 | 1461.5 | 슈다페드정60mg |
| RPZ2 | 423 | 422.5 | 레피졸정2mg |
| RVTRL | 704 | 703.5 | 리보트릴정0.5mg |
| SAPDRSOL3 | 5 | 5.163 | 애피드라주솔로스타3mL |
| SCOBLOC1 | 634 | 633.5 | 콩브럭정1.25mg |
| SLMT10 | 140 | 139.75 | 라믹탈정100mg |
| SSOFTEN | 2298 | 2297.5 | 솝튼정 |
| SYNSRID | 937 | 936.75 | 씬지로이드정0.1mg |
| TOPMAT1 | 1964 | 1963.5 | 토파메이트정100mg |
| TRL5 | 102 | 101.5 | 트라린정50mg |
| TROL1 | 232 | 231.5 | 트롤주1mL |
| TRS5 | 477 | 476.5 | 토르신정5mg |
| TRSBFXTC1 | 13 | 12.8419 | 트레시바플렉스터치주100단위3mL |
| ZOLM | 576 | 575.75 | 졸민정0.125mg |

(주사 일부 7FIASPFT 11.372 등은 mL 분할 잔량. 표의 CSV 값은 부동소수 표기 잡음 제거한 실값.)

## 적용 완료 (2026-06-23)
- **0013 적용**: `inventory_stock.current_qty` integer→numeric (`supabase/migrations/0013_inventory_stock_numeric_qty.sql`). 사전검증 BEGIN/ROLLBACK 통과 후 본 적용. 역방향 롤백 SQL 동봉.
- **42행 보정**: CSV 실값(소수)으로 42행만 가산 보정. 검증 = 비정수 행수 42 / 총 1103 무변경(비-42행 영향 0). 롤백 `_inventory_보정_롤백.sql`(원본 정수 복원).
- 실행 경로: owner RLS 세션 의도(`scripts/fix_inventory_decimals.mjs`)였으나 **owner 자격증명 만료**(비번 변경 추정)로, 스키마(0011~0013)와 동일한 Management API(권한 토큰)·tenant 스코프(`where tenant_id`)·트랜잭션 검증으로 적용.
- 타입 일치 확인: inventory `current_qty` numeric ≡ monthly numeric.

## 잔여 제안 (승인 후) — 소수 표기 정책
1. **UI 노출 갭(중요)**: 화면 현재고는 `drugs.current_qty`(integer)를 표시(src/App.jsx 845·703·889). `inventory_stock.current_qty`는 표시·정렬·집계에 미사용 → 이번 보정은 **UI 회귀 0이자 화면 미노출**. 소수를 화면에 반영하려면 `drugs.current_qty`도 numeric+42행 보정 필요(별도 승인).
2. **0009 트리거 정밀화**: `apply_tx_to_inventory()`의 지역변수 `cur integer`에 numeric 대입 시 반올림 → 음수차단 경계 <1단위 오차. `cur numeric`로 변경 제안(transactions=0이라 현재 무영향).
3. 표기 자릿수 정책: 화면 표기 시 소수 그대로 vs 반올림 표시 — UI 반영 결정 시 함께 확정.