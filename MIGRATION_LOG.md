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

> **P1 진행 메모 (2026-06-21)**
> - `yakflo_data`는 DB 테이블이 아니라 **원천 엑셀**(1,103행·42컬럼). 적재 대상은 운영 `drugs`(0002 캡처 1083행) → **P1-2 적재는 이미 과거 수행**.
> - 어휘 7종 중 `복합/단일`·`전문/일반` 컬럼이 라이브 부재 → 0006에서 additive 추가(NULL 허용).
> - 라이브 `drugs`(1083행)에 CHECK/NOT NULL 제약은 **걸지 않음** — 0002 원칙대로 데이터 안정화(P1-3) 이후로 미룸.
> - **P1-2/3/4 미완**: 원천 엑셀 또는 라이브 DB 조회 권한 필요. `verify/P1_data_verification.sql`을 사용자가 Supabase에서 실행 → 결과로 P1-3(확인필요 225건·보관방법 483건 보강) 백로그 확정 예정.
> - `drug_lots`: App.jsx LotModal이 사용하나 0002 시점 DB 부재 기록 → **현 존재 여부 확인 필요**(가이드 §12 신규 설계 후보).
