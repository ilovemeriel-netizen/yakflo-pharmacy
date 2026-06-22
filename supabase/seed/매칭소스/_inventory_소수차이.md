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

## 제안 (승인 시에만 적용 — 지금 미적용)
monthly와 정합을 맞추려면 inventory도 numeric 보존:
```sql
-- 0013 (제안): inventory_stock 수량 numeric 확장 (가산·비파괴)
alter table public.inventory_stock alter column current_qty type numeric;
-- 이후 42건만 CSV 실값으로 가산 보정(예시; 본적용 시 스크립트로 일괄):
--   update inventory_stock set current_qty = 286.5 where tenant_id='<cnc>' and drug_code='GRD2'; ...
-- 롤백: alter column current_qty type integer using round(current_qty)::int;  -- ⚠ 소수 절삭
```
- 트레이드오프: numeric 전환은 가산(무손실). 단 UI·집계가 정수 가정이면 표기 확인 필요 → **승인 후** UI 영향 점검과 함께 진행 권장.
- 미적용 사유: 운영 정본 값 보정은 승인 필요(무범위 UPDATE 금지 원칙).