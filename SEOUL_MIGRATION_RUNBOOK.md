# 약플로 Supabase 리전 이전 런북 — Sydney → Seoul (실행본)

> 옛 프로젝트 `yakflo-pharmacy-Sydney`(ref `ukzjhiweqezhrtqzpjkf`, ap-southeast-2)를
> 새 프로젝트 `yakflo-pharmacy`(ref `phgkjrvdtcdrdiuigici`, **Seoul** ap-northeast-2)로 이전.
> 핵심 원칙: 옛 프로젝트는 **검증 완료 후 마지막에만 삭제**. 비밀키는 커밋 금지.

## 데이터 출처 구분
| 대상 | 출처 | 방법 |
|---|---|---|
| 스키마(테이블·RLS·함수) | 옛 DB | `0000_baseline.sql` 단일 스냅샷 |
| 약품·이관(drugs·inventory_stock·monthly_snapshots) | **개선본 `yakflodata.xlsx`(1103행)** | `scripts/load_yakflodata.mjs` |
| 공유 레퍼런스 7개(drug_master·dur_* 등) | 옛 DB | 데이터 복사(거의 빈 상태, drug_master 5행) |
| 메타 3개(profiles·tenants·tenant_members) | 재로그인 | 새 UUID로 `0007` 재연결 |

## 실제 사용 도구 (이 환경에서 막힘 → 우회)
- `supabase db dump`는 **Docker 필요** → Docker 미설치. 대신 **pg_dump**(PostgreSQL 18, winget 설치)로 스키마 덤프.
- 직접 연결 `db.<ref>.supabase.co`는 IPv6 전용 → DNS 실패. **Session pooler**(`aws-1-<region>.pooler.supabase.com:5432`, user `postgres.<ref>`) 사용.
- 새 프로젝트 적용은 **`supabase login` access token + Management API**(`POST https://api.supabase.com/v1/projects/{ref}/database/query`)로 SQL 실행 → DB 비밀번호 우회. service_role은 `GET .../api-keys?reveal=true`로 취득.

---

## Phase A · 옛 DB 스키마 덤프 (pg_dump)
```bash
$env:PGPASSWORD="<옛 DB 비밀번호>"
pg_dump -h aws-1-ap-southeast-2.pooler.supabase.com -p 5432 \
  -U postgres.ukzjhiweqezhrtqzpjkf -d postgres \
  --schema public --schema-only -f supabase/migrations/0000_baseline.sql
# 레퍼런스 7개 데이터(선택):
pg_dump ... --data-only -t public.drug_master -t public.drug_discontinuation ... -f supabase/reference_data.sql
```

## Phase B · 새 프로젝트에 스키마 적용 (Management API)
`0000_baseline.sql`에서 다음을 제거 후 적용:
- `\restrict` / `\unrestrict` (psql 메타 — API는 순수 SQL만)
- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ...` (권한 거부)
- `CREATE SCHEMA public;` (Supabase 신규 프로젝트에 기본 존재)

적용 시 **UTF-8 강제**(한글 COMMENT 깨짐 방지). 빈 프로젝트면 `DROP SCHEMA IF EXISTS public CASCADE;` 선행 후 클린 적용.
그다음 `0006_p1_controlled_vocab.sql`을 적용해 `drug_vocab` 25행 seed.

**검증**: 정상 테이블 15 + `drug_vocab`, RLS 17정책, `drugs`의 `*_own_tenant` 4정책.

## Phase C · 약품 1103 적재 (로더)
```powershell
$env:SUPABASE_URL="https://phgkjrvdtcdrdiuigici.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<새 service_role>"
$env:YAKFLO_XLSX="<yakflodata.xlsx 경로>"
node scripts/load_yakflodata.mjs           # dry-run: 유효 1103 확인
node scripts/load_yakflodata.mjs --commit  # 적재
```
적재 규칙: 헤더 3행, 전월재고 수량→현재고 이월, 입출고/폐기/반품 0, 약품코드 문자열 강제.
**드러난 실제 스키마 차이**: 보험약가→`edi_price`(insurance_price 컬럼 없음), `drug_code` unique 없음(일반 insert), 수량·금액 전부 integer(반올림). 코드 없는 **중지 약품 282개 → `NOCODE-` 합성코드**.

**검증**: drugs/inventory_stock/monthly_snapshots 각 **1103**, transactions 0, 이관 고아 0.
분포: 경구802·주사137·외용130·수액18·영양13·의약외품3 / 사용517·중지578·휴면8 / 일반857·확인필요225·향정13·한외마약5·마약3.

## Phase D · 인증 재설정 (대시보드 — 사용자)
- Auth → Providers: 카카오/네이버 Client ID·Secret 재입력
- Auth → URL Configuration: Site URL + Redirect URLs(배포·`http://localhost:5173`)
- 카카오/네이버 개발자 콘솔: Redirect URI → `https://phgkjrvdtcdrdiuigici.supabase.co/auth/v1/callback`

## Phase E · 환경변수 교체 (사용자)
- 로컬 `.env`: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` → 새 프로젝트
- Netlify / Vercel: 동일 키 + 서버 키(`SUPABASE_SERVICE_ROLE_KEY`·`DATA_API_KEY`·`MFDS_API_KEY`·`NAVER_*`) 교체 → 재배포

## Phase F · 메타 재연결 (0007)
새 프로젝트에서 카카오 등으로 **재로그인**(새 `auth.users` 생성) → `0007_relink_users_after_region_move.sql` 실행(이메일 기준 owner/admin·테넌트 재연결).

## Phase G · 검증 후 옛 프로젝트 삭제 (최종)
앱 로그인 → 약품 1103 표시 → 테넌트 격리 확인 → 공공API 프록시 정상.
**모두 정상일 때만** 옛 Sydney 프로젝트 삭제.

## 보안
- `.env`·`*.xlsx`·`supabase/.temp/`·데이터 덤프·service_role/PAT/DB비번 → `.gitignore`로 커밋 금지.
- 이전 중 채팅에 노출된 옛 DB 비밀번호는 옛 프로젝트 삭제로 무효화.
