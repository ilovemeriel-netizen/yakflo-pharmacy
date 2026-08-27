# MIGRATION_LOG — Yakflo (yakflo-pharmacy) SaaS 전환

## 🧷 롤백 기준점 (Rollback Anchor)

| 항목 | 값 |
|---|---|
| **기준 커밋 (SHA)** | `f50e306eb9b73d775a16a2282ec78d4d2e89813b` |
| **짧은 SHA** | `f50e306` |
| **커밋 메시지** | `chore: 프로젝트명 cnc-pharmacy → yakflo-pharmacy` |
| **기준 커밋 날짜** | `2026-05-25 09:43:38 +0000` (UTC) |
| **기준 브랜치** | `main` (origin/main과 동기화 완료) |
| **작업 브랜치** | `saas-migration` (이 커밋에서 분기) |
| **로그 작성 시각** | `2026-05-25` |
| **원격 저장소** | `https://github.com/ilovemeriel-netizen/yakflo-pharmacy.git` |
| **운영 도메인 (당시)** | `https://yakflo-pharmacy.netlify.app/` |

## 🎯 SaaS 전환 목표 (작업 진행 시 단계별 채워나감)

> 이 섹션은 각 단계 진행 시 누적 기록됩니다. 현재는 안전망 구축만 완료.

- 대상: 100~150병상 재활/요양병원 약제과
- 멀티 테넌시·결제·관리자 패널·온보딩 등 도입 예정 (구체 범위는 다음 단계에서 협의)

## 🔁 롤백 절차 (문제 발생 시)

SaaS 전환 작업 중 또는 후에 문제가 생기면 아래 절차로 즉시 복원 가능합니다.

### 1) 로컬 — 작업 브랜치 폐기하고 main으로 복원
```bash
git checkout main
git branch -D saas-migration         # 작업 브랜치 삭제
# 필요 시 stash로 임시 백업: git stash push -m "saas-migration WIP"
```

### 2) 원격에 push했고 main에도 머지된 경우 — 머지 커밋 되돌리기
```bash
# 머지 커밋이 HEAD인 경우
git revert -m 1 HEAD
git push origin main
```

### 3) 강제로 기준점까지 main 되돌리기 (⚠️ 협업자 있으면 위험 — 단독 작업 한정)
```bash
git checkout main
git reset --hard f50e306eb9b73d775a16a2282ec78d4d2e89813b
git push --force-with-lease origin main
```

### 4) 외부 서비스 원복 체크리스트 (도입한 서비스에 한정)
| 항목 | 원복 조치 |
|---|---|
| 결제(Stripe 등) 신규 연동 | Dashboard에서 키 비활성화 + 환경변수 제거 |
| Supabase RLS 정책 변경 | 기준 시점 SQL로 재실행 (이전 정책 복원) |
| 신규 추가 테이블 | `DROP TABLE IF EXISTS ...` (CASCADE 주의) |
| 신규 환경변수 (Netlify/Vercel) | 콘솔에서 삭제 후 재배포 |
| 도메인/서브도메인 | DNS·Netlify에서 매핑 해제 |

## 🛡 보안·운영 정책 재확인

- ✅ `.env` 파일은 `.gitignore:28`에 포함되어 있어 절대 커밋되지 않음
- ✅ `.env`는 현재 untracked 상태로 안전
- ✅ 비밀 키는 Netlify/Vercel 환경변수로만 관리
- ⚠️ SaaS 전환 시 신규 도입되는 비밀(결제·이메일·관리자 토큰 등)도 동일 원칙 적용

## 📦 기준 시점 환경

- Node.js: 24.14.0
- 프레임워크: React 19.2.4 + Vite 8.0.1
- PWA: vite-plugin-pwa 1.3.0
- 백엔드: Supabase (project: `ukzjhiweqezhrtqzpjkf`)
- 배포: Netlify (primary) + Vercel (병행)
- 주요 dep: `@supabase/supabase-js@2.100.1`, `xlsx@0.18.5`

상세 의존성: `package.json` 참조

## 📝 작업 이력 (이후 단계에서 누적 기록)

| 일자 | 단계 | 변경 요약 | 커밋 |
|---|---|---|---|
| 2026-05-25 | 0. 안전망 | `saas-migration` 브랜치 생성 + MIGRATION_LOG.md 작성 | (이번 단계) |
| 2026-06-21 | P0. 환경점검 | `.env.example`에 `MFDS_API_KEY` 보강(이름만). build✅/lint baseline 103e·8w 기록 | `yakflo-runbook-p0` |
| 2026-06-21 | P1-1. 통제어휘 | `0006_p1_controlled_vocab.sql`(어휘 7종 seed `drug_vocab` + `drugs.compound_type`·`prescription_type` 추가, 비강제) + `verify/P1_data_verification.sql`(검증 SELECT) | `yakflo-runbook-p0` |
| 2026-06-21 | 리전 이전 | `0007_relink_users_after_region_move.sql` — Sydney→Seoul 이전 후 이메일 기준 사용자 재매핑(tenant_members owner/member + profiles admin), 옛 UUID 비의존 | `yakflo-runbook-p0` |
| 2026-06-21 | 리전 이전 | `scripts/load_yakflodata.mjs` — 개선본 1103 적재 로더(drugs+inventory+snapshot, 전월재고→현재고 이월·입출고0·약품코드 문자열강제, dry-run 기본, env service_role) | `yakflo-runbook-p0` |
| 2026-06-21 | 리전이전 실행 | **새 Seoul 프로젝트(ref `phgkjrvdtcdrdiuigici`) 구축 완료**: `0000_baseline.sql`(pg_dump 스키마)+0006 적용, 1103 적재 | `yakflo-runbook-p0` |
| 2026-08-23 | 재고무결. current_qty 가드 | `0055_guard_drugs_qty_direct.sql` — drugs.current_qty **직접 UPDATE 차단**(BEFORE UPDATE 트리거 `trg_guard_drugs_qty_direct`, `NEW.current_qty IS DISTINCT FROM OLD` 조건, 오류 23514). 예외 방식: **세션 변수 `app.qty_via_tx`**(tx-local) — `apply_tx_to_inventory`·`revert_tx_from_inventory`가 drugs 갱신 직전 `'on'`·직후 `'off'`(0055가 두 함수를 flag 버전으로 `create or replace`, 가드와 원자 적용). INSERT 미차단(신규 current_qty:0 허용). 선행조건 충족(src 직접쓰기 0건). dryrun A~L 통과 후 승인 apply. 재검증 11항목 통과(직접UPDATE 23514 차단·타컬럼 통과·거래INSERT Δ반영·0056 감사 path='거래(trigger)'·bulk_stock_adjust 정상·inventory 반영·drugs 1,112 무변동·정본 885,285,628/7월 106,365,758·8월 EQM100 반품 1건 잔존). 코드 무변경(번들 무변동). | `feat/0055-guard-dryrun` |
| 2026-08-23 | 참고. 0068 상태 | `0068_assign_clear_atc_slot.sql`은 **0069_slot_rpc_pinned_movable가 `assign_atc_slot`·`clear_atc_slot`를 `create or replace`로 대체**(0069 헤더 명시). 운영 DB에 두 함수는 0069 정의(FSP2·4·5만 서버 고정·상비 이동 허용)로 존재, ATC 화면이 정상 호출. → **0068 별도 apply 불요(조치 불요)**. | (기록만) |
| 2026-08-23 | 참고. 공휴일 레퍼런스 | `0075_holidays.sql` — 공휴일 자동표시용 `holidays` 공유 레퍼런스 테이블(전 테넌트 공유·tenant_id 없음) 신규 도입. drug_master(0041) 패턴: **anon/authenticated 전면 회수 → authenticated SELECT only → service_role 쓰기 → RLS on → `holidays_select_all`(for select to authenticated using true)**. UNIQUE(date,name)·year/date 인덱스. 한국천문연구원 특일정보를 service_role이 upsert, 화면은 읽기 전용. 정본·거래 무관 신규 테이블(dryrun BEGIN→생성→검증→ROLLBACK 통과 후 apply). | (기록만) |
| 2026-08-23 | 보안. 공유레퍼런스 RLS | `0076_shared_ref_rls.sql` — 공유 레퍼런스 6개(`drug_discontinuation`·`drug_harmful`·`drug_status_alerts`·`dur_age_contraindication`·`dur_elderly_caution`·`dur_pregnancy_contraindication`)를 drug_master(0041)/holidays(0075) 패턴으로 정렬: **anon 전면 회수 · authenticated SELECT only · RLS on · SELECT 정책 1종(authenticated,using true) · 쓰기는 service_role**. 배경: 6개가 RLS off+anon·authenticated CRUD 전권(익명 쓰기 가능, 6개 모두 0행·src 참조 0건). dryrun A~J 전항 통과(RLS on·anon 회수·auth SELECT only·auth INSERT 42501 차단·service_role 쓰기 보존·drug_master/holidays·운영4테이블·정본 무변동) 후 승인 apply. apply 후 재검증 9항목 통과(정본 885,285,628/7월 106,365,758 무변동, 6개 0행 복귀, allow_all qual=true 9건 전부 SELECT·cmd=ALL 0건). 코드 무변경(번들 해시 `index-DRkZ2TTM.js` 유지). | `feat/0076-shared-ref-rls` |
| 2026-08-24 | 보안. profiles role 가드 | `0077_guard_profiles_role_direct.sql` — **profiles.role 자가승격 차단**(BEFORE UPDATE 트리거 `trg_guard_profiles_role_direct` + 함수 `guard_profiles_role_direct`, 0055 패턴·SECURITY INVOKER). 배경: `profiles_update_own`이 `USING(auth.uid()=id)`만 있고 WITH CHECK가 없어 사용자가 자기 role을 'admin'으로 변경 가능(권한 상승). 네이버 콜백이 service_role `admin.createUser`로 disable_signup을 우회해 외부 계정 생성이 가능해 위험도 상향. 차단 조건: **`NEW.role IS DISTINCT FROM OLD.role AND current_user='authenticated' AND NOT is_admin()`** → 위반 시 23514(check_violation). **통과 경로 3종**: ① service_role(관리 스크립트·네이버 콜백, current_user≠authenticated) ② postgres(마이그레이션) ③ 관리자(is_admin=true). role 이외(settings·email·이름) update와 INSERT(handle_new_user 가입)는 무영향. RLS WITH CHECK는 OLD 참조 불가라 트리거가 유일 해법(`profiles_update_own` 정책 무수정). dryrun A~K 전항 통과 후 승인 apply. apply 후 재검증 9항목 통과(role 미변경 settings self-update·drugCols/changeCols 보존·일반사용자 23514 차단·admin/service_role 통과·행수 1·정책 71 무변동·트리거 +1·정본 885,285,628/7월 106,365,758). 코드 무변경(번들 무변동). | `feat/0077-profiles-role-guard` |
| 2026-08-27 | 정합. bulk_stock_adjust 금액 반올림 | `0078_bulk_stock_adjust_round_amount.sql` — bulk_stock_adjust의 `total_amount = v_diff * coalesce(v_pp,0)` → **`round(...)` 명시**(CREATE OR REPLACE, 시그니처 `(jsonb,date,text)`·파라미터·나머지 로직 무변경). 배경: `transactions.total_amount`=bigint. **실제 오류(22P02 "invalid input syntax for type bigint")는 프론트 직접 insert**(보정 App.jsx:829·TxForm 2867)에서 PostgREST가 JS 소수(-781091.5)를 bigint로 파싱하며 발생 → PR #242(`40ca3a1`)의 **Math.round로 이미 해소**. **RPC 자체는 `numeric×numeric→bigint` SQL 대입 캐스트라 원래 오류 없이 자동 반올림**되던 정상 경로 — 0078은 반올림을 **명시·일관화**하는 개선(동작 동일). dryrun(BEGIN→검증→ROLLBACK): 신 함수 소수 diff 통과·total_amount 정수 저장·quantity(numeric) 소수 보존·정수 회귀 무영향·마감월 차단 유지. apply 후 재검증 7항목 통과(함수정의 round() 반영·소수 diff total_amount 정수(예 -100.1×24 → round -2402)·정수 회귀·quantity 소수 보존(-100.1)·마감월(2026-07) 차단·0055 가드 23514·정본 885,285,628/7월 106,365,758). 검증용 조정 전량 ROLLBACK(운영 무잔류: ADLT 150·ORFILSTR15 7724.1 원복, drugs 1114·tx 962). 코드 무변경(번들 `index-BIA5DGBD.js` 무변동). 롤백: 0057 원본 함수(round 없는 `v_diff * coalesce(v_pp,0)`)로 CREATE OR REPLACE 복원. | `feat/total-amount-round`(#242, 파일) · 본 apply |

> **리전 이전 실행 기록 (2026-06-21) — 완료된 부분**
> - 도구: Docker 미설치 → `pg_dump`(PostgreSQL 18 winget 설치)로 옛 DB 스키마 덤프. 새 프로젝트 적용은 `supabase login` 토큰으로 **Management API(`/database/query`)** 사용(DB 비밀번호 우회).
> - 옛 Sydney ref=`ukzjhiweqezhrtqzpjkf`(pooler `aws-1-ap-southeast-2`), 새 Seoul ref=`phgkjrvdtcdrdiuigici`.
> - baseline 적용 시 제거한 것: `\restrict`/`\unrestrict`(psql 메타), `ALTER DEFAULT PRIVILEGES`(권한거부), `CREATE SCHEMA public`(기본 존재). UTF-8 강제(한글 COMMENT 깨짐 방지).
> - **검증 통과**: 15정상테이블+drug_vocab(25)+RLS17정책, drugs/inv/snap 각 **1103**, tx 0, 고아 0. 분포 §8 일치. 코드없는 중지약품 **282개에 NOCODE- 합성코드**.
>   - **[2026-08-23 갱신]** 위 값은 리전 이전 적재 **직후(2026-06-21)** 스냅샷임. 현재는 `transactions`가 채워져 있어 「tx 0」은 **구 기재(오류)** — 판단 전 재측정(2026-08-23 기준 약 **869행**). `drugs`도 이후 적재/조정으로 변동(2026-08-23 기준 약 **1,112행**, 재고 보유 약 526종, 평가금액 약 111,681,296원). **행수·금액은 변동하므로 판단 전 반드시 재측정.**
> - drugs 실측: `insurance_price` 없음(→`edi_price`), drug_code unique 없음(일반 insert), 모든 수량·금액 integer(반올림).
> - ⚠️ **미완(사용자 진행 필요)**: 인증 재설정(카카오/네이버 Provider·Redirect URL), `.env`·Netlify·Vercel 키 교체, 재로그인 후 `0007` 실행(메타 재연결), 앱 검증, 옛 프로젝트 삭제. 레퍼런스 7테이블은 거의 빈 상태(drug_master 5행, `supabase/reference_data.sql` 미적용).
> - 🔐 노출된 옛 DB 비밀번호(채팅)는 옛 프로젝트 삭제로 무효화 예정. 새 프로젝트 service_role/access token은 미노출.

> **리전 이전 결정 메모 (재생성 가이드 v1.1, 2026-06-21)**
> - **위험2**: 스키마 = 옛 DB `public` 단일 스냅샷 `0000_baseline.sql`만 psql 직접 적용. `db push`/0001~0007 재적용 금지("already exists" 방지). 0001~0007은 이력 보존만.
> - **약품 데이터**: 옛 1083 복사 ❌ → 개선본 `yakflodata.xlsx` 1103행 적재. 적재 후 drugs=**1103**이 정상.
> - 출처: drugs/inventory_stock/monthly_snapshots → xlsx · 공유 레퍼런스 7개 → 옛 DB 복사 · 메타 3개 → 재로그인 후 0007로 재연결.
> - 0007은 가이드 **8단계에서 수동 실행**(스냅샷/푸시 아님).
> - ⚠️ 로더 미확정: `inventory_stock` 현재고 컬럼명(`CONFIG.INVENTORY_QTY_COL`)은 `0000_baseline.sql`에서 확인 후 확정. xlsx 헤더도 실제 파일 대조 필요.

> **P1 진행 메모 (2026-06-21)**
> - `yakflo_data`는 DB 테이블이 아니라 **원천 엑셀**(1,103행·42컬럼). 적재 대상은 운영 `drugs`(0002 캡처 1083행) → **P1-2 적재는 이미 과거 수행**.
> - 어휘 7종 중 `복합/단일`·`전문/일반` 컬럼이 라이브 부재 → 0006에서 additive 추가(NULL 허용).
> - 라이브 `drugs`(1083행)에 CHECK/NOT NULL 제약은 **걸지 않음** — 0002 원칙대로 데이터 안정화(P1-3) 이후로 미룸.
> - **P1-2/3/4 미완**: 원천 엑셀 또는 라이브 DB 조회 권한 필요. `verify/P1_data_verification.sql`을 사용자가 Supabase에서 실행 → 결과로 P1-3(확인필요 225건·보관방법 483건 보강) 백로그 확정 예정.
> - `drug_lots`: App.jsx LotModal이 사용하나 0002 시점 DB 부재 기록 → **현 존재 여부 확인 필요**(가이드 §12 신규 설계 후보).
>   - **[2026-08-23 갱신]** `drug_lots`는 **존재 확인** — `0008`에서 생성, `0063`에서 UNIQUE(tenant_id,drug_code,lot_no)+`drugs.expiry_date` 최단 유효기한 캐시 트리거. 「부재/미확인」은 **구 기재(오류)**.
