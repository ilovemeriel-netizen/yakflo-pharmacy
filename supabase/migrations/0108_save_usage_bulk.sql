-- 0108_save_usage_bulk.sql   ★ 시안 — **적용하지 않았다**(dryrun 결과만 보고)
--
-- 목적: 사용량을 **한 번에**(원자적으로) 저장한다. 지금은 줄마다 UPDATE 해서
--       중간에 끊기면 **절반만 들어간 상태**가 남는다(App.jsx:2302 의 for 루프).
--
-- 두 가지 쓰임을 한 함수로 받는다
--   · 일괄 등록 — p_fields 에 세 칸을 다 주고 p_zero_missing=false
--   · 개별 등록 — p_fields 에 한 칸만 주고 p_zero_missing=true
--     (「파일에 없는 약품은 0」 — 2026-11-04 이정화 님 결정)
--
-- ★ 계산식은 한 글자도 바꾸지 않는다 (App.jsx:2291 과 같은 식)
--     전년 또는 3개월이 들어오면  monthly_avg  = 3개월 있으면 round(r3/3), 없으면 round(py/12)
--                                safety_stock = ceil(monthly_avg * 1.2)
--                                max_stock    = round(monthly_avg * 3)
--     **1개월만** 들어오면 월평균·안전재고·최대재고를 **건드리지 않는다**.
--
-- ★ 권한은 0105c·0107 과 **같은 판정**이다. 세 곳이 갈라지면 화면과 DB 가 다른 말을 한다.
-- ★ SECURITY INVOKER 로 둔다 — 0105 트리거가 auth.uid() 로 다시 판정하므로
--   DEFINER 로 만들면 그 판정이 함수 주인 기준으로 바뀌어 무력해진다.

begin;

create or replace function public.app_save_usage_bulk(
  p_fields        text[],
  p_rows          jsonb,
  p_zero_missing  boolean default false,
  p_keep_codes    text[]  default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_srole  text := session_user;
  v_grole  text := coalesce(current_setting('role', true), 'none');
  v_mrole  text;
  v_do_py  boolean := 'prev_year_usage' = any(p_fields);
  v_do_r3  boolean := 'recent_3m_usage' = any(p_fields);
  v_do_r1  boolean := 'recent_1m_usage' = any(p_fields);
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
                when v_do_r3 and i.r3 is not null then round(i.r3 / 3)
                when v_do_py and i.py is not null then round(i.py / 12)
                else d.monthly_avg end)
        else d.monthly_avg end,
      safety_stock = case when (v_do_py and i.py is not null) or (v_do_r3 and i.r3 is not null)
        then (case
                when v_do_r3 and i.r3 is not null then ceil(round(i.r3 / 3) * 1.2)
                when v_do_py and i.py is not null then ceil(round(i.py / 12) * 1.2)
                else d.safety_stock end)
        else d.safety_stock end,
      max_stock = case when (v_do_py and i.py is not null) or (v_do_r3 and i.r3 is not null)
        then (case
                when v_do_r3 and i.r3 is not null then round(round(i.r3 / 3) * 3)
                when v_do_py and i.py is not null then round(round(i.py / 12) * 3)
                else d.max_stock end)
        else d.max_stock end,
      usage_source = 'manual'
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
        usage_source = 'manual'
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
end $$;

revoke execute on function public.app_save_usage_bulk(text[], jsonb, boolean, text[]) from public;
revoke execute on function public.app_save_usage_bulk(text[], jsonb, boolean, text[]) from anon;
grant  execute on function public.app_save_usage_bulk(text[], jsonb, boolean, text[]) to authenticated;

commit;

-- ═══ 확인 (읽기 전용 — 함수를 실행하지 않는다) ═══
--   select has_function_privilege('anon','public.app_save_usage_bulk(text[],jsonb,boolean,text[])','execute') as anon,
--          has_function_privilege('authenticated','public.app_save_usage_bulk(text[],jsonb,boolean,text[])','execute') as authenticated;
--   → anon false · authenticated true

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   drop function if exists public.app_save_usage_bulk(text[], jsonb, boolean, text[]);
--   ⚠ 이미 저장된 사용량 값은 되돌아가지 않는다(감사표 drug_usage_audit 에 이력이 남아 있다).
