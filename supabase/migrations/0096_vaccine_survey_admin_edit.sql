-- ════════════════════════════════════════════════════════════════════════════
-- 0096 — 신청 명단의 수량·희망일을 관리자가 고칠 수 있게 한다(기록을 남기면서).
--
-- ★ 왜 GRANT 확대가 아니라 SECURITY DEFINER 함수인가
--   이 기능의 핵심은 「고친 기록을 반드시 남긴다」다. 열 GRANT 를 넓히면 화면이
--   UPDATE 와 audit INSERT 를 **따로** 보내게 되어 둘 중 하나만 성공할 수 있다.
--   함수 안에서 하면 같은 트랜잭션이라 기록 없는 수정이 생길 수 없다.
--   (0095 에서 정한 「기록은 서버가 책임진다」와 같은 방향이다.)
--
-- ★ status 도 같은 이유로 함수로 옮기고, 열 UPDATE GRANT 를 **회수**한다.
--   지금까지 상태 변경(취소/되살리기)은 기록 없이 저장되고 있었다.
--
-- ★ SECURITY DEFINER 는 RLS 를 우회한다. 그래서 함수 첫머리에서 호출자를 직접 막는다
--   — current_tenant_ids() 소속 + is_tenant_admin. purge_vaccine_survey 와 같은 방식.
--
-- ★ 기존 CHECK 와 희망일 트리거를 **우회하지 않는다**. 함수는 평범한 UPDATE 를 하고
--   check 제약·trg_vaccine_survey_response_guard 가 그대로 걸린다. 여기서는 그보다
--   먼저 알아듣기 쉬운 메시지로 막아 줄 뿐이다.
--
-- ★ 가족 수를 접종 완료 수보다 작게 낮추는 것은 **거절**한다(사용자 결정).
--   접종 완료를 임의로 깎지 않는다 — 이미 맞은 사람 수는 화면이 함부로 줄일 값이 아니다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) 기록 종류 — 'edit' · 'cancel' · 'restore' 를 더한다 ───────────────────
alter table public.vaccine_survey_audit
  drop constraint if exists vaccine_survey_audit_action_chk;
alter table public.vaccine_survey_audit
  add constraint vaccine_survey_audit_action_chk
  check (action in ('view_raw', 'export_pdf', 'export_xlsx', 'purge',
                    'edit', 'cancel', 'restore'));

comment on constraint vaccine_survey_audit_action_chk on public.vaccine_survey_audit is
  'view_raw·export_* = 열람/내려받기, purge = 파기, edit = 수량·희망일 수정, cancel/restore = 상태 변경';

-- ── 2) 공통 — 호출자 검사 ───────────────────────────────────────────────────
-- 두 함수가 같은 검사를 하므로 한 곳에 둔다. 응답 id 로 회차·tenant 를 찾아 돌려준다.
create or replace function public.assert_survey_response_admin(p_id uuid)
  returns table (resp_id uuid, survey_id uuid, tenant_id uuid,
                 family_count int, done_family int, self_dose boolean,
                 wish_date date, status text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare r record;
begin
  select x.id, x.survey_id, x.tenant_id, x.family_count, x.done_family,
         x.self_dose, x.wish_date, x.status
    into r
    from public.vaccine_survey_responses x
   where x.id = p_id;

  if not found then
    raise exception '신청을 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.current_tenant_ids() t where t = r.tenant_id) then
    raise exception '권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_tenant_admin(r.tenant_id) then
    raise exception '관리자만 고칠 수 있습니다' using errcode = 'insufficient_privilege';
  end if;

  resp_id      := r.id;      survey_id    := r.survey_id;
  tenant_id    := r.tenant_id;
  family_count := r.family_count; done_family := r.done_family;
  self_dose    := r.self_dose;    wish_date   := r.wish_date;
  status       := r.status;
  return next;
end $$;

-- ── 3) 수량·희망일 수정 ─────────────────────────────────────────────────────
-- null 을 넘긴 칸은 건드리지 않는다(바뀐 칸만 갱신).
create or replace function public.edit_vaccine_survey_response(
  p_id           uuid,
  p_self_dose    boolean default null,
  p_family_count int     default null,
  p_wish_date    date    default null)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  cur       record;
  v_self    boolean;
  v_family  int;
  v_wish    date;
begin
  select * into cur from public.assert_survey_response_admin(p_id);

  v_self   := coalesce(p_self_dose,    cur.self_dose);
  v_family := coalesce(p_family_count, cur.family_count);
  v_wish   := coalesce(p_wish_date,    cur.wish_date);

  /* 바뀐 것이 없으면 기록도 남기지 않는다 — 칸을 벗어나기만 해도 쌓이면 안 된다 */
  if v_self is not distinct from cur.self_dose
     and v_family is not distinct from cur.family_count
     and v_wish is not distinct from cur.wish_date then
    return;
  end if;

  /* ★ 접종 완료보다 적게 낮추는 것은 막는다. CHECK 도 같은 것을 막지만
     메시지가 「check_violation」 뿐이라 화면이 안내 문구를 만들 수 없다. */
  if v_family < cur.done_family then
    raise exception '가족 접종 완료 %명보다 적게 바꿀 수 없습니다', cur.done_family
      using errcode = 'restrict_violation';
  end if;
  if v_family < 0 or v_family > 20 then
    raise exception '가족 수는 0~20 사이여야 합니다 (받은 값 %)', v_family
      using errcode = 'check_violation';
  end if;
  if not v_self and v_family <= 0 then
    raise exception '본인 또는 가족 중 최소 1명은 접종해야 합니다'
      using errcode = 'check_violation';
  end if;

  /* 희망일 범위는 trg_vaccine_survey_response_guard 가 막지만, 먼저 같은 말로 알린다 */
  if p_wish_date is not null then
    declare s record;
    begin
      select vax_start, vax_end into s from public.vaccine_surveys where id = cur.survey_id;
      if v_wish < s.vax_start or v_wish > s.vax_end then
        raise exception '희망일이 접종 기간(% ~ %) 밖입니다', s.vax_start, s.vax_end
          using errcode = 'check_violation';
      end if;
    end;
  end if;

  update public.vaccine_survey_responses
     set self_dose    = v_self,
         family_count = v_family,
         wish_date    = v_wish,
         updated_at   = now()
   where id = p_id;

  /* 같은 트랜잭션에서 기록 — 채움 트리거(0095)가 tenant_id·user_id 를 넣는다 */
  insert into public.vaccine_survey_audit (survey_id, action, response_id)
  values (cur.survey_id, 'edit', p_id);
end $$;

-- ── 4) 상태 변경(취소 / 되살리기) ───────────────────────────────────────────
create or replace function public.set_vaccine_survey_status(
  p_id     uuid,
  p_status text)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  cur record;
  v_action text;
begin
  if p_status not in ('applied', 'cancelled') then
    raise exception '알 수 없는 상태입니다 (%)', p_status using errcode = 'check_violation';
  end if;

  select * into cur from public.assert_survey_response_admin(p_id);

  if cur.status = p_status then
    return;                       /* 같은 값이면 기록하지 않는다 */
  end if;

  v_action := case when p_status = 'cancelled' then 'cancel' else 'restore' end;

  update public.vaccine_survey_responses
     set status = p_status, updated_at = now()
   where id = p_id;

  insert into public.vaccine_survey_audit (survey_id, action, response_id)
  values (cur.survey_id, v_action, p_id);
end $$;

-- ── 5) 권한 ────────────────────────────────────────────────────────────────
grant execute on function public.edit_vaccine_survey_response(uuid, boolean, int, date) to authenticated;
grant execute on function public.set_vaccine_survey_status(uuid, text)                  to authenticated;
-- assert_* 는 위 두 함수가 안에서만 부른다 — 바깥에 노출하지 않는다
revoke all on function public.assert_survey_response_admin(uuid) from public;

-- ★ status 열 직접 수정 회수 — 이제 기록을 남기는 함수로만 바꿀 수 있다.
--   done_self·done_family·updated_at 은 그대로 둔다(명단 체크는 기록 대상이 아니다).
revoke update (status) on public.vaccine_survey_responses from authenticated;

comment on function public.edit_vaccine_survey_response(uuid, boolean, int, date) is
  '관리자가 신청의 본인여부·가족수·희망일을 고친다. 같은 트랜잭션에서 audit(edit) 1건을 남긴다.';
comment on function public.set_vaccine_survey_status(uuid, text) is
  '관리자가 신청을 취소/되살린다. 같은 트랜잭션에서 audit(cancel|restore) 1건을 남긴다.';
