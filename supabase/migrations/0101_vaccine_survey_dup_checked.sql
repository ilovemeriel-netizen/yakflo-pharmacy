-- ════════════════════════════════════════════════════════════════════════════
-- 0101 — 관리자가 「동명이인 확인 완료」를 처리하는 함수.
--
-- ★ 왜 함수인가 — 0096 이 관리 화면에 준 열 UPDATE 권한은
--   done_self · done_family · updated_at **셋뿐**이다. 화면이 dup_checked_at 을
--   직접 쓸 수 없고, 권한을 넓히면 0096 이 세운 「기록은 서버가 책임진다」가 깨진다.
--   함수 안에서 하면 같은 트랜잭션이라 **기록 없는 처리가 생길 수 없다.**
--
-- ★ 바뀐 값을 0098 의 changes 에 담는다.
-- ★ 동명이인으로 **선언된 건**에만 쓸 수 있다 — 아무 신청에나 표시를 남기지 않는다.
-- ★ 같은 값이면 아무 것도 하지 않는다(기록도 남기지 않는다) — 0096·0098 과 같은 규칙.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.mark_vaccine_survey_dup_checked(
  p_id      uuid,
  p_checked boolean default true)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  cur    record;
  v_decl boolean;
  v_was  timestamptz;
  v_now  timestamptz := now();
begin
  /* 권한 판정은 0096 의 것을 그대로 쓴다 — 소속 tenant + 관리자 */
  select * into cur from public.assert_survey_response_admin(p_id);

  select dup_declared, dup_checked_at into v_decl, v_was
    from public.vaccine_survey_responses where id = p_id;

  if not coalesce(v_decl, false) then
    raise exception '동명이인으로 표시된 신청이 아닙니다'
      using errcode = 'restrict_violation';
  end if;

  if (v_was is not null) = coalesce(p_checked, true) then
    return;                       /* 같은 값이면 기록하지 않는다 */
  end if;

  update public.vaccine_survey_responses
     set dup_checked_at = case when p_checked then v_now else null end,
         dup_checked_by = case when p_checked then auth.uid() else null end,
         updated_at     = v_now
   where id = p_id;

  insert into public.vaccine_survey_audit (survey_id, action, response_id, changes)
  values (cur.survey_id, 'edit', p_id,
          jsonb_build_object('dup_checked',
            jsonb_build_object('from', v_was is not null, 'to', coalesce(p_checked, true))));
end $$;

grant execute on function public.mark_vaccine_survey_dup_checked(uuid, boolean) to authenticated;

comment on function public.mark_vaccine_survey_dup_checked(uuid, boolean) is
  '동명이인 「확인 완료」 처리. 처리하면 「확인 필요」 숫자에서 빠진다. '
  '열 GRANT 를 넓히지 않으려고 함수로 둔다(0096 과 같은 이유). 기록은 같은 트랜잭션에서 남는다.';
