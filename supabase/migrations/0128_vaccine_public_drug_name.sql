-- ═══════════════════════════════════════════════════════════════
-- 0128 — 백신 계정에 「공개 제품명」 칸을 더한다
--
-- 왜
--   공개 화면의 약품명은 drugs.drug_name 을 **규칙으로 다듬어** 만든다.
--   「이름이 괄호로 끝나면 괄호 안이 제품명」이라는 추측인데,
--   「스카이조스터주(대상포진생바이러스백신)」처럼 괄호 안이 **성분 설명**이면
--   진짜 제품명을 버리고 엉뚱한 글자를 보여 준다(2026-11-13 운영에서 확인).
--   같은 유형이 세 번째다 — 추측을 그만두고 **적어 둔 대로** 보여 준다.
--
-- 안전한 점
--   · 비워 둘 수 있다(NULL). 비어 있으면 **지금 규칙 그대로** 동작한다.
--     → 기존 계정 9개는 손대지 않아도 화면이 한 글자도 바뀌지 않는다.
--   · 권한은 표 수준 GRANT 라 새 칸에 자동으로 붙는다.
--   · 읽기 전용(viewer) 차단은 trg_viewer_readonly 트리거가 이미 막는다.
--
-- ★ 빈 글자·공백만 넣는 것도 막는다 — btrim 한 길이로 본다.
--   비울 생각이면 NULL 을 넣어야 한다(화면이 그렇게 저장한다).
--
-- ★ 함정 #22 — 칸을 더한 뒤 스키마 캐시를 갱신하고, 새 칸이 API 에서 보이는 것을
--   확인한 다음에 그 칸을 쓰는 코드를 배포한다.
-- ═══════════════════════════════════════════════════════════════

alter table public.vaccine_accounts
  add column if not exists public_drug_name text;

alter table public.vaccine_accounts
  drop constraint if exists vaccine_accounts_public_drug_name_chk;

alter table public.vaccine_accounts
  add constraint vaccine_accounts_public_drug_name_chk
  check (public_drug_name is null
         or (char_length(btrim(public_drug_name)) between 1 and 40));

comment on column public.vaccine_accounts.public_drug_name is
  '공개 화면에 보일 제품명. 비우면(NULL) drugs.drug_name 을 규칙으로 다듬어 쓴다. 0128';

-- ★ 스키마 캐시 갱신 — 이 줄이 빠지면 새 칸이 API 에 안 보인다(함정 #22)
notify pgrst, 'reload schema';
