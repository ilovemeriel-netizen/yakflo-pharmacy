# 데이터–UI 계약표 (DATA_UI_CONTRACT) — P2 단일 기준

> 모든 P2 컴포넌트는 이 표를 **단일 기준**으로 따른다. 컬럼명은 신규 Seoul 프로젝트
> `0000_baseline.sql` **실측**(추측 아님). 조회·쓰기는 **anon 키 + RLS** 경유, `tenant_id`는 트리거가 자동 채움.
> 근거 설계: 통합구현가이드 2·6·7·9장 + 미반영분석·타당성보고서 4-1.

## 0. 핵심 사실 (구현 전 합의)
- **조인 축 = `drug_code`(text)**. 모든 이관 테이블이 이 컬럼으로 drugs를 참조(FK 0건 → 코드 조인). ⚠️ **`drug_code`에 unique 인덱스 없음**(PK는 `id`) → 360°/조인 신뢰성·성능 위해 **가산적 unique index 권장**(P2-2 선결, 별도 마이그레이션).
- **약가/코드 실측 매핑**: 보험약가 = **`edi_price`**(`insurance_price` 컬럼 없음). 보험코드 후보 **2개 공존** = `insurance_code`·`edi_code` → 정본 1개 확정 필요(아래 §6 미결).
- **재고 필드 중복**: `current_qty`·`safety_stock`·`max_stock`·`monthly_avg`·`prev_year_usage`·`recent_3m_usage`가 **drugs·inventory_stock 양쪽** 존재 → 정본 = **`inventory_stock`(운영 현재고, 가이드 §6-2)**, `drugs.current_qty`는 마스터 시드. (UI 조회 우선순위: inventory_stock → drugs fallback)
- **부재 컬럼**: drugs에 **ATC·대/중/소분류·efficacy_class 없음** → 가이드 §9 "ATC 대분류 도넛"은 데이터 소스 부재. 분류 도넛은 **`category`(구분)·`status`·마약구분**으로 구성.
- **통제 어휘 = `drug_vocab`(axis, code, label, sort_order)** → 모든 필터·드롭다운의 **단일 소스**(하드코딩 CATS/STATS 대체).
- 금액(수량×단가)은 **저장 않고 계산**(가이드 §6-3). 무거운 집계는 향후 VIEW/RPC.

---

## 1. 약품 목록 뷰 (drugs)
| 화면 컬럼 | DB 컬럼 | 비고 |
|---|---|---|
| 코드 | `drugs.drug_code` | 조인 축, 클릭 → 360° |
| 약품명 | `drugs.drug_name` | |
| 구분 | `drugs.category` | drug_vocab `axis=category` |
| 현재고 | `inventory_stock.current_qty` ← `drugs.current_qty` | 정본=inventory_stock |
| 유효기한 | `drugs.expiry_date` | date |
| 상태 | `drugs.status` | drug_vocab `axis=status` |
| **(ATC)** | — | ❌ 컬럼 부재 → 기본 표시에서 제외(또는 구분으로 대체) |

**확장(표시 컬럼 토글, P2-3)**: `ingredient_kr`/`ingredient_en`(성분) · `insurance_type`(급여, vocab `insurance`) · `insurance_code`/`edi_code`(보험코드) · `edi_price`(보험약가) · `storage_method`(보관, vocab `storage`) · `compound_type`(vocab `compound`) · `prescription_type`(vocab `rx_class`) · `manufacturer` · `specification`/`standard` · `unit`.

## 2. 필터 (전부 drug_vocab 기반)
| 필터 | DB 컬럼 | drug_vocab axis |
|---|---|---|
| 구분 | `drugs.category` | `category` (6) |
| 상태 | `drugs.status` | `status` (사용·휴면·중지) |
| 급여구분 | `drugs.insurance_type` | `insurance` |
| 마약구분 | `drugs.is_narcotic`+`narcotic_type` | `narcotic_class` (일반·향정·마약·한외마약) |
| 보관방법 | `drugs.storage_method` | `storage` |
| 복합/단일 | `drugs.compound_type` | `compound` |
| 전문/일반 | `drugs.prescription_type` | `rx_class` |

## 3. 약품 360° 탭 (코드 조인, `WHERE drug_code = :code`)
| 탭 | 소스 테이블 | 주요 컬럼 |
|---|---|---|
| 개요 | `drugs` | drug_code·drug_name·category·ingredient_*·compound_type·prescription_type·insurance_type·edi_price·edi_code·storage_method·status·is_narcotic·narcotic_type |
| 입출고 | `transactions` | type(입고/출고/반품/폐기)·quantity·unit_price·total_amount·transaction_date·supplier·handler·approver·reason·lot_no·process_status |
| 재고 | `inventory_stock` | current_qty·safety_stock·max_stock·monthly_avg·prev_year_usage·recent_3m_usage·stock_status·order_alert |
| 유효기한 | `drugs` (+`transactions`) | drugs.expiry_date·lot_no / transactions.expiry_date·lot_no ⚠️ **로트별 관리는 `drug_lots` 부재 → 제한**(부수 결정) |
| 향정 | `drugs`+`transactions` | drugs.is_narcotic·narcotic_type + 해당 약품 입출고 이력(규제 추적) |

## 4. 대시보드 도넛 세그먼트 (가이드 §9)
| 도넛 | DB 소스 | 클릭 라우팅 |
|---|---|---|
| 구분 분포 | `drugs.category` group by | 약품관리(필터: category=세그먼트) |
| 규제 분포 | `is_narcotic`+`narcotic_type` group by | 향정관리(필터) |
| 상태 분포 | `drugs.status` group by | 약품관리(필터: status=세그먼트) |
| ~~ATC 대분류~~ | ❌ 컬럼 부재 | 미지원 — 구분 분포로 대체 |

**KPI 카드**: 총 약품 `count(drugs)` · 향정/마약 `count(is_narcotic=true)` · 유효기한 임박 `count(expiry_date ≤ today+90d)` · 재고소진 `count(inventory_stock.current_qty=0)`.

## 5. 상태 분기 (status, drug_vocab `axis=status`)
| 상태값 | UI 처리 | 데이터 |
|---|---|---|
| 사용 | 메인 뷰 우선 정렬 | `status='사용'` (517) |
| 휴면 | "대기" 배지, 메인 근처 | `status='휴면'` (8) |
| 중지 | 아카이브 라우트 분리 | `status='중지'` (578) |
> 세 상태가 **동일 그리드 컴포넌트**를 필터만 달리해 재사용.

## 6. 통합 거래 등록 (transactions, 현재 0건)
| 폼 필드 | DB 컬럼 | 비고 |
|---|---|---|
| 거래구분 | `type` | 입고/출고/반품/폐기 토글 (단일 폼) |
| 약품 | `drug_code` | drugs 검색·선택 |
| 수량 | `quantity` | int |
| 단가 | `unit_price` | int (금액=수량×단가, 저장은 total_amount) |
| 일자 | `transaction_date` | date |
| 로트/유효기한 | `lot_no`·`expiry_date` | |
| 공급처·담당·승인 | `supplier`·`handler`·`approver` | |
| 사유·상태·메모 | `reason`·`process_status`·`memo` | |
> 쓰기는 RLS·권한(owner/admin/member) 경유.
> **재고 단일 정본(P2-4 확정)**: `inventory_stock.current_qty`·`drugs.current_qty`는 거래 트리거
> `trg_apply_tx_to_inventory`(0009)**만** 갱신한다 — 입고 +, 출고·폐기·반품 −(공급처 반품), 음수 재고는 예외로 차단.
> UI·다른 경로에서 `current_qty`를 **직접 수정 금지**(재고는 거래로만 변동). 활성화/복귀는 `status`만 변경.

### 재고 현황 상태 분기 (inventory_stock 기준)
| 상태 | 조건 | 색 |
|---|---|---|
| 재고없음 | `current_qty = 0` | 회색/적 |
| 부족 | `safety_stock>0 AND current_qty < safety_stock` | 적 |
| 발주 | 부족 + 발주점 도달 | 주황 |
| 과잉 | `max_stock>0 AND current_qty > max_stock` | 보라 |
| 정상 | 그 외 | 녹 |
> ⚠️ `safety_stock`·`max_stock`은 적재 시 0/null → **현재 대부분 '정상/재고없음'으로 귀결**. 실데이터 보강 전까지 한계.

---

## 7. 미결 사항 → 결정 (P2-2 재대조 결과 반영)
1. ✅ **보험코드 정본 = `insurance_code`** — 라이브 실측: `insurance_code` 523건 / `edi_code` 0건(빈값). edi_code 미사용.
2. ✅ **재고 정본 = `inventory_stock`** — `drugs.current_qty`는 마스터 시드, 운영 현재고는 inventory_stock.
3. ✅ **drug_lots 신설** — `0008` 마이그레이션으로 생성(App LotModal 호환 컬럼 + RLS + tenant 트리거). 유효기한 탭은 drug_lots(로트별) + drugs.expiry_date(대표) 병행.
4. ✅ **drug_code unique index 추가** — 라이브 중복 0 확인 → `drugs(tenant_id, drug_code)` unique(`0008`).
5. ✅ **ATC 부재 → 구분(category) 분포로 대체** (대시보드 도넛).

> 보험약가 = `edi_price`(>0 506건). 코드 조인은 RLS 테넌트 스코프 내에서 `drug_code` 단일 축.
