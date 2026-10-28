-- ════════════════════════════════════════════════════════════════════════════
-- 0095 — 수요조사 감사 기록의 tenant_id · user_id 를 **서버가 채운다**
--
-- ■ 고치는 결함
--   수요 현황 탭의 「엑셀」·「PDF」·「정정」이 전부 42501 로 막혔다:
--     new row violates row-level security policy for table "vaccine_survey_audit"
--   0093 의 INSERT 정책은 세 조건이고, 실제 사용자 권한으로 재현해 보니
--     tenant_id IN current_tenant_ids()  = true
--     is_tenant_admin(tenant_id)         = true
--     user_id = auth.uid()               = **NULL** ← 이것만 false
--   화면이 `profile?.id` 를 보냈는데 그 객체는 tenant_members 행이라 `id` 열이 없다.
--   undefined → 열이 아예 빠짐 → user_id NULL → `NULL = auth.uid()` 는 NULL(=false).
--
-- ■ 고치는 방향 — **정책을 느슨하게 하지 않는다.**
--   WITH CHECK 는 한 글자도 바꾸지 않는다. 대신 BEFORE INSERT 트리거가
--     tenant_id := 그 회차(survey_id)의 tenant_id
--     user_id   := auth.uid()
--   로 **덮어쓴다**. 클라이언트가 무엇을 보내든(또는 빠뜨리든) 서버 값이 이긴다.
--   그래서 같은 실수가 다시 나도 기록이 어긋나거나 막히지 않는다.
--
-- ■ 왜 0093 dryrun 이 못 잡았나
--   그 검증은 기본 연결(postgres = 테이블 소유자)로 돌아 **RLS 를 우회**했다.
--   그래서 정책이 한 번도 평가되지 않았다. 0095 의 verify 는
--   SET LOCAL ROLE authenticated + request.jwt.claims 로 **실제 권한에서** 확인한다.
--
-- ★ 기존 테이블·뷰·정책 무변경. 정책 수 121 그대로.
-- ★ append-only 가드(trg_vaccine_survey_audit_append_only)는 건드리지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.fill_vaccine_survey_audit()
  returns trigger
  language plpgsql
  security definer                      -- 회차 조회가 RLS 에 막히지 않게. 권한 판단은 정책이 한다.
  set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
begin
  /* 기록의 소속은 **회차가 정한다** — 클라이언트가 보낸 tenant_id 는 쓰지 않는다.
     set_tenant_id_from_user() 처럼 「사용자의 첫 tenant」를 쓰면 여러 tenant 에 속한
     사용자에서 엉뚱한 소속이 박힐 수 있다. */
  select s.tenant_id into v_tenant
  from public.vaccine_surveys s
  where s.id = new.survey_id;

  if v_tenant is null then
    raise exception '회차를 찾을 수 없습니다 (survey_id=%)', new.survey_id
      using errcode = 'foreign_key_violation';
  end if;

  new.tenant_id := v_tenant;
  new.user_id   := auth.uid();

  /* 로그인하지 않은 호출(auth.uid() 가 NULL)은 여기서 끊는다.
     그러지 않으면 NOT NULL 위반(23502)이라는 엉뚱한 메시지가 화면에 간다. */
  if new.user_id is null then
    raise exception '로그인 정보가 없어 기록을 남길 수 없습니다'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

comment on function public.fill_vaccine_survey_audit() is
  '감사 기록의 tenant_id(회차 기준) 와 user_id(auth.uid()) 를 서버가 채운다. 클라이언트 값은 덮어쓴다.';

-- ★ 기존의 범용 tenant 채움 트리거는 이 테이블에서 뗀다 — 새 트리거가 더 정확하게
--   (회차 기준으로) 채우므로 중복이고, 「사용자의 첫 tenant」 방식은 오히려 위험하다.
drop trigger if exists trg_set_tenant_id on public.vaccine_survey_audit;

drop trigger if exists trg_vaccine_survey_audit_fill on public.vaccine_survey_audit;
create trigger trg_vaccine_survey_audit_fill
  before insert on public.vaccine_survey_audit
  for each row execute function public.fill_vaccine_survey_audit();
