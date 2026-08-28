-- 0081_drugs_efficacy_class.sql
-- 목적: drugs.efficacy_class(약효분류명) 컬럼 신설 — 코드는 이미 완비, 컬럼만 없어 값이 조용히 버려지던 문제 해소.
--   · 배경: App.jsx 10곳(입력칸 3·저장 payload 3·API 매핑 2·폼 상태 2)이 efficacy_class를 다루나
--     drugs에 컬럼이 없어 PostgREST가 PGRST204를 반환 → 0051 계열 폴백이 키를 조용히 제거하고 재시도 →
--     사용자에겐 「등록 완료」로 보이나 값은 미저장. #243 additive·compound_type과 같은 유형(세 번째 사례).
--   · 컬럼이 생기면 코드 무수정(0줄)으로 즉시 동작한다 — 저장 3경로(INSERT 575·2512, UPDATE 599)가 이미 payload에 포함.
--   · efficacy_class는 마이그레이션 이력에 한 번도 없었다(만들었다 지운 것이 아니라 처음부터 부재).
--
-- ★ NULL 허용(NOT NULL·DEFAULT·CHECK 없음) — 판단 근거:
--   ① 기존 1,114건은 「값이 없음」이 사실. DEFAULT ''를 주면 「빈 문자열을 입력함」과 구분이 사라진다.
--      (기존 efficacy는 text DEFAULT ''이나, 이는 구 DB 덤프(0000_baseline)를 물려받은 것이지 의도된 사양이 아니다.)
--   ② 코드가 저장 시 `f.efficacy_class || null`·`form.efficacy_class||null`로 **빈값을 NULL로 보낸다**
--      → NOT NULL이면 빈칸 저장이 23502로 실패한다. NULL 허용이 코드와 정합.
--   ③ 값 성격이 자유 텍스트(공공API divNm 원문)라 CHECK로 열거할 수 없다.
--   ④ 0080(drug_idle_reviews)에서 status CHECK를 뺀 것과 같은 취지 — 값 확장 시 마이그레이션 불필요.
--
--   · 정본(monthly_snapshots)·거래·금액 무관 — 컬럼 추가 DDL. 인덱스·제약 없음.
--   · backfill(drug_master.drug_class 등)은 이번 범위 밖 — 별건 판단.
--   · dryrun(BEGIN→ALTER→검증→ROLLBACK) 통과 후 승인받아 apply.

alter table public.drugs
  add column if not exists efficacy_class text;

comment on column public.drugs.efficacy_class is '약효분류명 — 공공데이터 divNm/efficacyClass 자동입력. 자유 텍스트·NULL 허용. efficacy(효능)와 별개 컬럼.';

-- 롤백(참고):
-- alter table public.drugs drop column if exists efficacy_class;
