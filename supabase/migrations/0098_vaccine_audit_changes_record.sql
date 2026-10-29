-- ════════════════════════════════════════════════════════════════════════════
-- 0098 — 수정·상태 변경이 「바뀐 칸만」 감사 기록에 적는다.
--
-- ★ 0097(칸 추가)이 먼저 적용되고 스키마 캐시가 갱신된 뒤에 적용한다.
--   순서를 바꾸면 함수가 없는 칸에 쓰려 해 42703 으로 터진다.
--
-- ★ 담는 모양: {"칸":{"from":옛값,"to":새값}} — **바뀐 칸만** 넣는다.
--   대상 칸: family_count · self_dose · dose · wish_date · status · done_self · done_family
--   ★ 성명·사번·연락처·신청번호는 한 칸도 넣지 않는다. 기록을 보는 것만으로
--     개인을 알 수 있게 되면 audit 자체가 개인정보 저장소가 된다.
--     (누가 무엇을 했는지는 user_id·response_id 로 이미 추적된다.)
--
-- ★ 「접종 완료」(done_self·done_family)는 화면이 **직접 UPDATE** 한다 — 0096 이
--   그 3칸의 열 GRANT 를 남겨 두었기 때문이다(기록 대상이 아니라고 보았다).
--   그 경로를 바꾸지 않고, 트리거로 기록만 더한다. 화면 코드 변경 0줄.
--   ※ 트리거는 **로그인한 사용자일 때만** 기록한다 — 공개 사이트(service_role)는
--     auth.uid() 가 없어 fill 트리거(0095)가 user_id NOT NULL 에서 터지고,
--     그러면 **공개 경로의 UPDATE 까지 실패**한다. 그 길을 막지 않는다.
--
-- ★ 기존 동작은 그대로다 — 바뀐 것이 없으면 여전히 기록하지 않고, 거절 조건·
--   메시지·권한 판정도 0096 과 같다. 더한 것은 changes 뿐이다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) 수량·희망일 수정 ─────────────────────────────────────────────────────
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
  v_changes jsonb := '{}'::jsonb;
  v_dose0   int;
  v_dose1   int;
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

  /* ── 바뀐 칸만 담는다 ─────────────────────────────────────────────────── */
  if v_self is distinct from cur.self_dose then
    v_changes := v_changes || jsonb_build_object(
      'self_dose', jsonb_build_object('from', cur.self_dose, 'to', v_self));
  end if;
  if v_family is distinct from cur.family_count then
    v_changes := v_changes || jsonb_build_object(
      'family_count', jsonb_build_object('from', cur.family_count, 'to', v_family));
  end if;
  if v_wish is distinct from cur.wish_date then
    v_changes := v_changes || jsonb_build_object(
      'wish_date', jsonb_build_object('from', cur.wish_date, 'to', v_wish));
  end if;
  /* 도즈 = 본인(1/0) + 가족 수 — 화면이 보는 값이라 함께 남긴다 */
  v_dose0 := (case when cur.self_dose then 1 else 0 end) + cur.family_count;
  v_dose1 := (case when v_self        then 1 else 0 end) + v_family;
  if v_dose1 is distinct from v_dose0 then
    v_changes := v_changes || jsonb_build_object(
      'dose', jsonb_build_object('from', v_dose0, 'to', v_dose1));
  end if;

  update public.vaccine_survey_responses
     set self_dose    = v_self,
         family_count = v_family,
         wish_date    = v_wish,
         updated_at   = now()
   where id = p_id;

  /* 같은 트랜잭션에서 기록 — 채움 트리거(0095)가 tenant_id·user_id 를 넣는다 */
  insert into public.vaccine_survey_audit (survey_id, action, response_id, changes)
  values (cur.survey_id, 'edit', p_id, v_changes);
end $$;

-- ── 2) 상태 변경(취소 / 되살리기) ───────────────────────────────────────────
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

  insert into public.vaccine_survey_audit (survey_id, action, response_id, changes)
  values (cur.survey_id, v_action, p_id,
          jsonb_build_object('status', jsonb_build_object('from', cur.status, 'to', p_status)));
end $$;

-- ── 3) 접종 완료 수 — 직접 UPDATE 경로를 바꾸지 않고 기록만 더한다 ──────────
create or replace function public.log_vaccine_survey_done_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v jsonb := '{}'::jsonb;
begin
  /* ★ 로그인한 사용자가 아니면 기록하지 않는다 — 0095 의 채움 트리거가
     user_id := auth.uid() 를 넣고 그 칸은 NOT NULL 이다. 공개 사이트
     (service_role)에서 터지면 그쪽 UPDATE 자체가 실패한다. */
  if auth.uid() is null then
    return new;
  end if;

  if new.done_self is distinct from old.done_self then
    v := v || jsonb_build_object('done_self', jsonb_build_object('from', old.done_self, 'to', new.done_self));
  end if;
  if new.done_family is distinct from old.done_family then
    v := v || jsonb_build_object('done_family', jsonb_build_object('from', old.done_family, 'to', new.done_family));
  end if;
  if v = '{}'::jsonb then
    return new;                   /* 바뀐 것이 없으면 기록하지 않는다 */
  end if;

  insert into public.vaccine_survey_audit (survey_id, action, response_id, changes)
  values (new.survey_id, 'edit', new.id, v);
  return new;
end $$;

drop trigger if exists trg_vaccine_survey_done_audit on public.vaccine_survey_responses;
create trigger trg_vaccine_survey_done_audit
  after update of done_self, done_family on public.vaccine_survey_responses
  for each row execute function public.log_vaccine_survey_done_change();

comment on function public.log_vaccine_survey_done_change() is
  '접종 완료 수(done_self·done_family) 변경을 audit 에 기록한다. 로그인 사용자만 — '
  '공개 경로(service_role)는 auth.uid() 가 없어 건너뛴다(0098 주석 참고).';
