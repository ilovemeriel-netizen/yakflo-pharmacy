-- ════════════════════════════════════════════════════════════════════════
-- 0133 — 저장 함수에도 **같은 반올림 규칙**을 넣는다 (2026-11-14 이정화 님 승인)
--
-- 왜
--   이정화 님 결정: 「최근3개월사용량 칸은 **사실**이라 실제 출고 숫자로 갱신하고,
--   월평균·안전재고만 반올림 규칙을 탄다.」
--   그러려면 화면이 「적용」할 때 3개월 숫자를 **그대로 보내야** 하는데,
--   지금 함수는 그 숫자로 월평균을 다시 세므로 `round(1/3)=0` 이 되어 **기준을 지워 버린다.**
--   그래서 규칙을 **함수 안에** 넣는다 — 0131(자동집계)과 **같은 잣대**가 된다.
--
-- 무엇을 바꾸나 — 3개월로 셈하는 갈래 **세 칸뿐**
--   · 3개월 출고가 **0 이면** 월평균·안전·최대를 **0 으로** (안 쓰는 약 — 규칙 그대로)
--   · 3개월 출고가 **있는데** 반올림이 0 이면 **기존 값을 그대로 둔다**
--   `recent_3m_usage` 는 **언제나 받은 값으로 갱신**한다 — 그것이 사실이다.
--
-- 무엇을 **안** 바꾸나
--   · 전년(py)으로 셈하는 갈래 — py/12 는 꼬리의 뜻이 달라 손대지 않는다
--   · p_source · 권한 검사 · 임시표 · 「0으로」 규칙 · 반환값 · 서명(CREATE OR REPLACE)
--
-- ★ 화면 쪽도 함께 고친다(같은 PR) — tiny 일 때 3개월 숫자를 **null 로 숨기지 않고** 보낸다.
--   대신 「셈할 바탕이 아예 없는 약」(마감 기록도 전년도 없는 약)만 null 로 보낸다.
-- ════════════════════════════════════════════════════════════════════════

begin;

CREATE OR REPLACE FUNCTION public.app_save_usage_bulk(p_fields text[], p_rows jsonb, p_zero_missing boolean DEFAULT false, p_keep_codes text[] DEFAULT '{}'::text[], p_source text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_srole  text := session_user;
  v_grole  text := coalesce(current_setting('role', true), 'none');
  v_mrole  text;
  v_do_py  boolean := 'prev_year_usage' = any(p_fields);
  v_do_r3  boolean := 'recent_3m_usage' = any(p_fields);
  v_do_r1  boolean := 'recent_1m_usage' = any(p_fields);
  v_src    text;
  v_saved     integer := 0;
  v_zeroed    integer := 0;
  v_unmatched text[]  := '{}';
begin
  if p_fields is null or array_length(p_fields, 1) is null then
    raise exception '저장할 항목을 고르지 않았습니다' using errcode = 'invalid_parameter_value';
  end if;
  if not (v_do_py or v_do_r3 or v_do_r1) then
    raise exception '알 수 없는 항목입니다' using errcode = 'invalid_parameter_value';
  end if;

  -- ★ 출처는 둘 중 하나만. 빈 값이면 옛 동작(manual)으로 본다.
  --   모르는 값을 조용히 넘기면 usage_source 에 쓰레기가 들어가 자동집계 판정이 흔들린다.
  v_src := coalesce(nullif(btrim(p_source), ''), 'manual');
  if v_src not in ('manual', 'auto') then
    raise exception '알 수 없는 사용량 출처입니다: %', p_source using errcode = 'invalid_parameter_value';
  end if;

  -- ═══ 권한 — 0105c·0107 과 같은 판정 ═══
  if not (coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
          or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none')) then
    if not exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id in (select current_tenant_ids())
    ) then
      select tm.role into v_mrole
        from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.tenant_id in (select current_tenant_ids())
       limit 1;
      raise exception '사용량은 관리자만 등록할 수 있습니다 [진단: uid=%, member_role=%, guc_role=%]',
        coalesce(left(auth.uid()::text, 8), '없음'),
        coalesce(v_mrole, '없음'),
        v_grole
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- 올라온 줄을 표로 편다. code 는 화면과 같은 규칙으로 다듬는다(trim·쉼표 제거·대문자).
  --
  -- ★ 먼저 지운다 — `on commit drop` 은 **트랜잭션이 끝날 때** 지운다. 그래서 한 트랜잭션 안에서
  --   이 함수를 두 번 부르면 두 번째가 `relation "_in" already exists` 로 **통째로 실패**한다.
  --   (2026-11-04 dryrun 에서 실제로 걸렸다. PostgREST 는 호출마다 트랜잭션이 끝나 운영에서는
  --    잘 드러나지 않지만, 배치·재시도·다른 함수 안에서 부르면 바로 터진다.)
  drop table if exists _in;
  create temporary table _in (
    code text primary key,
    py   numeric,
    r3   numeric,
    r1   numeric
  ) on commit drop;

  insert into _in (code, py, r3, r1)
  select upper(btrim(replace(x ->> 'code', ',', ''))),
         nullif(x ->> 'py', '')::numeric,
         nullif(x ->> 'r3', '')::numeric,
         nullif(x ->> 'r1', '')::numeric
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
   where coalesce(btrim(x ->> 'code'), '') <> ''
  on conflict (code) do nothing;      -- 같은 코드가 두 번 오면 화면에서 이미 합산해 보낸다

  -- 없는 약품코드는 돌려준다(조용히 버리지 않는다)
  select coalesce(array_agg(i.code), '{}') into v_unmatched
    from _in i
   where not exists (select 1 from public.drugs d where d.drug_code = i.code);

  -- ═══ ① 올라온 줄 저장 — 고른 칸만 ═══
  with upd as (
    update public.drugs d set
      prev_year_usage = case when v_do_py and i.py is not null then i.py else d.prev_year_usage end,
      recent_3m_usage = case when v_do_r3 and i.r3 is not null then i.r3 else d.recent_3m_usage end,
      recent_1m_usage = case when v_do_r1 and i.r1 is not null then i.r1 else d.recent_1m_usage end,
      /* ★ 월평균 계열 — 전년·3개월이 들어올 때만 다시 센다(1개월만이면 그대로) */
      monthly_avg = case when (v_do_py and i.py is not null) or (v_do_r3 and i.r3 is not null)
        then (case
                when v_do_r3 and i.r3 is not null
                  then coalesce(nullif(round(i.r3 / 3), 0), case when i.r3 > 0 then d.monthly_avg else 0 end)
                when v_do_py and i.py is not null then round(i.py / 12)
                else d.monthly_avg end)
        else d.monthly_avg end,
      safety_stock = case when (v_do_py and i.py is not null) or (v_do_r3 and i.r3 is not null)
        then (case
                when v_do_r3 and i.r3 is not null
                  then (case when round(i.r3 / 3) = 0 and i.r3 > 0 then d.safety_stock
                             else ceil(round(i.r3 / 3) * 1.2) end)
                when v_do_py and i.py is not null then ceil(round(i.py / 12) * 1.2)
                else d.safety_stock end)
        else d.safety_stock end,
      max_stock = case when (v_do_py and i.py is not null) or (v_do_r3 and i.r3 is not null)
        then (case
                when v_do_r3 and i.r3 is not null
                  then (case when round(i.r3 / 3) = 0 and i.r3 > 0 then d.max_stock
                             else round(round(i.r3 / 3) * 3) end)
                when v_do_py and i.py is not null then round(round(i.py / 12) * 3)
                else d.max_stock end)
        else d.max_stock end,
      usage_source = v_src                  -- ★ 여기만 바뀐다
    from _in i
    where d.drug_code = i.code
    returning 1
  )
  select count(*) into v_saved from upd;

  -- ═══ ② 파일에 없는 약품을 0 으로 — 개별 등록에서만 ═══
  --   ★ 고른 칸만 0 으로 만든다. 다른 칸·월평균 계열은 건드리지 않는다.
  --   ★ p_keep_codes 는 「0 으로 만들지 말 것」으로 화면에서 체크를 푼 약품이다.
  --   ★ 이미 그 칸이 0 인 약품은 세지 않는다(is distinct from 0).
  if p_zero_missing then
    with z as (
      update public.drugs d set
        prev_year_usage = case when v_do_py then 0 else d.prev_year_usage end,
        recent_3m_usage = case when v_do_r3 then 0 else d.recent_3m_usage end,
        recent_1m_usage = case when v_do_r1 then 0 else d.recent_1m_usage end,
        usage_source = v_src                -- ★ 여기도 같은 출처를 쓴다
      where not exists (select 1 from _in i where i.code = d.drug_code)
        and not (d.drug_code = any(coalesce(p_keep_codes, '{}')))
        and (
          (v_do_py and d.prev_year_usage is distinct from 0) or
          (v_do_r3 and d.recent_3m_usage is distinct from 0) or
          (v_do_r1 and d.recent_1m_usage is distinct from 0)
        )
      returning 1
    )
    select count(*) into v_zeroed from z;
  end if;

  return jsonb_build_object(
    'saved', v_saved,
    'zeroed', v_zeroed,
    'unmatched', to_jsonb(v_unmatched),
    'fields', to_jsonb(p_fields)
  );
end $function$;

commit;

notify pgrst, 'reload schema';
