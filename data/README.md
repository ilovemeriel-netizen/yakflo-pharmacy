# data/ — 운영 스크립트·시드 (로컬 전용)

이 디렉터리는 `.gitignore`의 `data/` 규약으로 **버전관리에서 제외**됩니다.
DB 접속 스크립트·시드 CSV 등 로컬 운영 자산을 보관하며, 공개 저장소에 올리지 않습니다.
(이 `README.md`만 예외 규칙으로 추적 대상입니다 — 아래 참고.)

## drug_master 레퍼런스 적재 절차

식약처·심평원 공공데이터 32,321건을 `public.drug_master`에 적재하는 절차입니다.

### 전제
- 환경변수 **`DATABASE_URL`** 을 `.env`에 설정 (운영 phg 서울, 소유자 역할).
  값은 저장소에 적지 않으며 `.env`는 gitignore 대상입니다.
- 시드 파일: **`data/drug_master_seed.csv`** (UTF-8 BOM, 헤더+32,321행, 27열).
  16MB·gitignore 대상이므로 저장소 밖에서 별도 보관·전달합니다.

### 1. 마이그레이션 적용 (Supabase SQL Editor / Management API)
순서를 지켜 적용합니다.
1. **`supabase/migrations/0041_drug_master_seed_prep.sql`**
   — 신규 11컬럼 추가 · RLS on · anon 권한 회수 · authenticated SELECT 전용 정책.
2. **`supabase/migrations/0042_widen_price_precision.sql`**
   — `edi_price`·`max_price` 정밀도 무제한 numeric(초고가 치료제 ~20억 수용).

> 0041만 적용하고 적재하면 `edi_price numeric(10,2)` 오버플로로 실패합니다. 반드시 0042까지 적용하세요.

### 2. 적재 (로더)
로더는 RFC4180 파서로 시드를 읽어 `main_code`(보험코드→표준코드→품목기준코드+규격)를 계산하고
`ON CONFLICT (main_code) DO UPDATE`로 UPSERT합니다.

```
# 리허설(dryrun) — BEGIN→UPSERT→집계→ROLLBACK, DB에 기록하지 않음
node data/load_drug_master.js

# 실제 적재(apply) — COMMIT
node data/load_drug_master.js apply
```

### 3. 검증 기대값
적재 후 아래와 일치해야 합니다.

| 항목 | 기대값 |
|---|---|
| 총 행수 | 32,321 |
| 급여 / 비급여 | 21,959 / 10,362 |
| main_code NULL / 중복 | 0 / 0 |
| main_code 출처(보험코드/표준코드/조합) | 21,959 / 8,939 / 1,423 |
| 통제어휘 이탈(category·narcotic_type·compound_type) | 0 |

### 4. 멱등성
`apply`를 다시 실행해도 **총 행수는 32,321로 불변**이어야 합니다(값도 변하지 않음).
증가하면 UPSERT 키(`main_code`) 문제이므로 중단하고 점검하세요.

### 권한 상태(적재 후)
- `authenticated`: SELECT 가능 / INSERT·UPDATE·DELETE 거부(RLS + GRANT 정비).
- 쓰기는 소유자·service_role(RLS 우회)만 가능 — 로더가 이 경로로 접속합니다.

---
※ 이 문서에는 접속 문자열·키·비밀번호·사용자명 등 민감정보를 적지 않습니다.