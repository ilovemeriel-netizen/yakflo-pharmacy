# status 보정 · safety 적재 · 트리거 일원화 (2026-06-23) — 자격증명 대기로 쓰기 보류

> 선행조건: anon+RLS owner 세션 로그인 성공 후 쓰기. **현재 LOGIN_FAIL → 쓰기 0건.**

## 0) owner 로그인 진단 (쓰기 차단 사유)
- `.owner-login.local`: 형식 정상(이메일=owner 일치, 비번 21자, 공백/따옴표/문제 BOM 없음).
- 계정(auth.users): confirmed=true · banned=null · has_pw=true · last_sign_in=04:41(성공 기록 존재).
- 그러나 파일 비번으로 로그인 실패(`Invalid login credentials`) → **파일의 비밀번호가 현재 계정 비번과 불일치**(옛 비번 잔존 또는 새 비번 오기입).
- 조치 요청: 마이페이지에서 **실제 로그인되는 현재 비번**을 `.owner-login.local`의 `password=`에 정확히 입력. 기억 안 나면 Supabase Dashboard→Authentication→Users→비번 재설정 후 파일 갱신. 갱신되면 아래 ①②를 즉시 실행.

## 1) status '??' 보정 (Task2) — 준비 완료·미실행
- 비정규 status 전수(사용/중지/휴면 외): **DWASPI100 1건** (status='??' hex 3f3f, qty 1500). 그 외 0건.
- **치환문자 전수 점검(2026-06-23 확장)**: drugs 11개 텍스트 컬럼(drug_name·ingredient_kr/en·manufacturer·category·specification·storage_method·memo·notes·dosage·status) 및 inventory_stock.drug_name에서 `?`(0x3F)·U+FFFD 잔재 검색 → **status 1건(DWASPI100)만 해당, 그 외 전부 0**. 한글 데이터는 정상 UTF-8(콘솔 깨짐은 표시 인코딩일 뿐). 즉 보정 대상은 1건 단독.
- 보정 스크립트 `scripts/fix_status_anomaly.mjs`(미리보기 기본, `--commit`/`--status=` 지정). 기본 보정값 '사용'(qty 1500·활성). 가드(원본값 그대로일 때만)·롤백 SQL 출력.
- 롤백: `update drugs set status='??' where tenant_id='<cnc>' and drug_code='DWASPI100';`

## 2) SACFN −305 (Task3) — 보류
- 원본(monthly_06)도 −305로 일치 → 시드오류 아님. **실사값 미제공 → 보류**, 명단만 유지. 실사값 수령 시 가역 보정.

## 3) safety_stock 적재 (Task4) — 보류(기준·자격증명 대기)
- 자동안(3개월 평균×0.5/×2) 코드는 `scripts/compute_safety_stock.mjs`(브랜치 feat/inventory-integrity). 하이브리드 확정 시: 자동 일괄 미리보기→--commit, **사용량0 130종은 적재 제외·명단 출력**.

## 4) 트리거 일원화 제안 (Task5) — 미적용
현 레거시 입출고(`src/App.jsx`)는 0009 트리거와 **이중 기록**:
| 위치 | 동작 | 문제 |
|---|---|---|
| 1514 INSERT + **1518** update | transactions 적재 직후 `drugs.current_qty`를 클라계산값으로 직접 set | 0009 트리거가 이미 drugs·inventory 동기 갱신 → 이중 기록·동시성/stale 시 divergence |
| 1517 `Math.max(0, old−q)` | 출고 시 음수를 0으로 무음 절삭 | 트리거의 음수차단(RAISE)을 가려 실제 부족을 숨김 |
| 1561 bulk update | 대량 입출고도 동일 직접 update | 동상 |
| 1524 delete + **1526** revert | tx 삭제 후 `drugs.current_qty` 수동 복원 | 0009는 AFTER INSERT만 → 삭제 복원이 수동 의존 |

**제안(미적용):**
1. **삽입 경로(1518·1561) 수동 update 제거** → 0009 트리거를 current_qty 단일 기록자(drugs+inventory 동기)로. 삽입 후 `onReload`로 트리거 결과 반영.
2. **음수 처리**는 클라 `Math.max(0,…)` 대신 트리거 `재고 부족` 예외에 위임(부족 사실 노출).
3. **삭제/복원(1526)**: (a) 0009에 AFTER DELETE 추가해 역델타 복원, 또는 (b) append-only(거래 삭제 금지·역거래로 정정) — 원칙상 **(b) 권장**.
4. 필요 시 마이그레이션 0015(역롤백 동봉)로 트리거 보강. 레거시 화면 수정은 별도 가역 작업(본 작업은 가산적·제안만).

## 게이트
- 쓰기 0(분석·제안·준비물만) → 운영 데이터 무변경 · 회귀 0 · build 무영향 · lint 103e/8w 불변 · 비밀 0.