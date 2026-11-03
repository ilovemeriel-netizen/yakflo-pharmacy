-- 0105c_usage_manager_role.sql
--
-- 목적: 0105 가 걸어 둔 「최고 관리자(owner)만」을 「이 약국의 관리자(owner·admin)」로 넓히고,
--       거절될 때 **왜 막혔는지**를 화면에서 바로 볼 수 있게 진단값을 붙인다.
--       2026-11-02 이정화 님 결정 ① — 화면도 같은 기준(memberRole 이 owner 또는 admin)이다(PR #393).
--
-- 왜 넓히나
--   · 0105 는 owner 한 사람만 통과시킨다. 그런데 화면은 admin 도 쓸 수 있게 했다.
--     그대로 두면 **화면에는 단추가 보이는데 누르면 거절**되는, 가장 헷갈리는 상태가 된다.
--   · 전역 프로필(profiles.role='admin')은 **넣지 않는다** — 그 사람은 이 약국의 멤버가 아니다.
--     판단 근거는 tenant_members 하나로만 둔다(화면도 같다).
--
-- 왜 진단값을 붙이나
--   · 2026-11-01 사용량 업로드가 막혔을 때, 문구만으로는 **무엇이 어긋났는지** 알 수 없었다
--     (로그인한 계정이 다른가 · 멤버가 아닌가 · 역할이 낮은가 · 웹 롤이 이상한가).
--   · 그래서 거절 문구에 네 가지만 덧붙인다:
--       uid(앞 8자리) · member_role · tenant_match(t/f) · guc_role
--   · ★ 토큰·비밀값은 넣지 않는다. uid 도 **앞 8자리**만 — 사람을 특정하지 않으면서
--     「같은 계정인가」만 가릴 수 있는 길이다.
--
-- ★ 바뀌는 것은 **누가 통과하느냐**와 **거절 문구**뿐이다.
--   판정 조건(session_user·GUC role 예외, auth.uid() 필수, 사용량 칸 비교)과
--   계산식·보호 범위·감사표·CHECK·트리거 배선은 한 글자도 건드리지 않는다.
--
-- ★ 아래 RPC 전문은 0105 파일에서 **기계적으로 복사**해 두 줄만 바꾼 것이다
--   (손으로 옮겨 적으면 두 벌이 어긋난다):
--       and tm.role = 'owner'                 →  and tm.role in ('owner', 'admin')
--       '출고 자동집계는 최고 관리자만 …'      →  '출고 자동집계는 관리자만 실행할 수 있습니다'
--
-- ★ 적용 전 dryrun 4가지(BEGIN→적용→시험→ROLLBACK)를 **전부** 통과해야 한다:
--     owner 통과 · admin 통과 · 일반 직원 거절 · 로그인 안 한 사람 거절

begin;

-- ═══════════════════════════════════════════════════════════════════
-- 1) 사용량 칸 수정 권한: owner → owner·admin  (+ 거절 문구에 진단값)
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.enforce_usage_edit_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  -- ★ SECURITY DEFINER 안에서 current_user 는 **함수 주인(postgres)** 으로 바뀐다.
  --   그걸로 관리자 여부를 보면 **모두가 관리자로 보여** 검사가 통째로 무력해진다
  --   (2026-11-02 dryrun 에서 일반 직원이 그대로 통과하는 것을 확인하고 고쳤다).
  --   session_user 는 SET ROLE·DEFINER 둘 다에 흔들리지 않는 **접속한 롤**이고,
  --   GUC 'role' 은 PostgREST 가 건 SET ROLE 결과(anon/authenticated/service_role)다.
  --   둘을 같이 봐야 「직접 접속한 관리자」와 「웹에서 들어온 사람」이 갈린다.
  v_srole text := session_user;
  v_grole text := coalesce(current_setting('role', true), 'none');
  -- 0105c: 거절 **문구에만** 쓰는 진단값. 판정에는 관여하지 않는다.
  v_mrole text;
begin
  -- 사용량 칸이 하나도 안 바뀌었으면 그냥 통과(다른 칸 저장은 무영향)
  if not (new.prev_year_usage is distinct from old.prev_year_usage
       or new.recent_3m_usage is distinct from old.recent_3m_usage
       or new.recent_1m_usage is distinct from old.recent_1m_usage
       or new.monthly_avg     is distinct from old.monthly_avg
       or new.usage_source    is distinct from old.usage_source) then
    return new;
  end if;

  -- 예외는 둘뿐이다: service_role(JWT) · 직접 접속한 관리 롤(마이그레이션·관리 스크립트).
  -- ★ 「auth.uid() 가 NULL 이면 통과」로 적으면 **로그인 안 한 사람(anon)까지 통과**한다.
  --   anon 은 RLS 가 따로 막아 주지만, 보호를 RLS 한 겹에만 기대면 그 정책이 느슨해지는 날
  --   조용히 뚫린다. 그래서 여기서도 직접 막는다.
  -- 웹에서 들어온 사람은 PostgREST 가 SET ROLE 을 걸어 v_grole 이 anon/authenticated 이므로
  -- 아래 예외에 걸리지 않는다. 직접 접속한 관리자는 SET ROLE 을 걸지 않아 'none' 이다.
  if coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
     or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none') then
    return new;
  end if;

  if not exists (
    select 1 from public.tenant_members tm
     where tm.user_id = auth.uid()
       and tm.tenant_id = new.tenant_id
       and tm.role in ('owner', 'admin')     -- 0105c: owner 단독에서 넓혔다
  ) then
    -- 0105c: 왜 막혔는지 화면에서 바로 보이게 진단값을 붙인다.
    --   ★ 토큰·비밀값은 넣지 않는다. uid 는 **앞 8자리**만 — 사람을 특정하지 않으면서
    --     「같은 계정인가」만 가릴 수 있는 길이다.
    --   ★ 이 조회는 **거절할 때만** 돈다. 통과 경로에는 질의를 더하지 않는다.
    select tm.role into v_mrole
      from public.tenant_members tm
     where tm.user_id = auth.uid()
       and tm.tenant_id = new.tenant_id
     limit 1;
    raise exception '사용량은 관리자만 수정할 수 있습니다 [진단: uid=%, member_role=%, tenant_match=%, guc_role=%]',
      coalesce(left(auth.uid()::text, 8), '없음'),
      coalesce(v_mrole, '없음'),
      case when v_mrole is not null then 't' else 'f' end,
      v_grole
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

-- ※ 트리거 배선(trg_enforce_usage_edit_owner)은 0105 것을 그대로 쓴다.
--   함수 본문만 갈아 끼우므로 drop/create trigger 를 다시 하지 않는다.

-- ═══════════════════════════════════════════════════════════════════
-- 2) 출고 자동집계 RPC: owner → owner·admin
--    ★ 0105 전문을 그대로 복사하고 위에 적은 두 줄만 바꿨다.
--    ★ 이 함수는 **정의만 갈아 끼운다** — 적용 중에 실행하지 않는다.
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.app_recompute_usage(p_overwrite_manual boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_count2 integer;
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_srole  text := session_user;                                    -- 접속한 롤 (SET ROLE 에 안 흔들린다)
  v_grole  text := coalesce(current_setting('role', true), 'none');  -- PostgREST 가 건 SET ROLE 결과
begin
  -- ⓐ owner 검사 — 0105 신규. 예외는 service_role(JWT)·직접 접속한 관리 롤뿐이다.
  --    ★ 「auth.uid() is null 이면 통과」로 적지 않는다 — 그러면 로그인 안 한 사람까지 통과한다.
  --    ★ current_user 도 쓰지 않는다 — 트리거 쪽 주석 참조(DEFINER 안에서 주인으로 바뀐다).
  if not (coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
          or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none')) then
    if not exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id in (select current_tenant_ids())
    ) then
      raise exception '출고 자동집계는 관리자만 실행할 수 있습니다'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- (A) recent_3m·prev_year·monthly_avg·safety·max: 출고 있는 약품만 갱신, manual 보존(기존 로직·무변경).
  with agg as (
    select t.drug_code,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
    from public.transactions t
    where t.type = '출고'
    group by t.drug_code
  ),
  calc as (
    select drug_code,
      coalesce(py, 0) as py,
      coalesce(r3, 0) as r3,
      case when coalesce(r3,0) > 0 then round(coalesce(r3,0) / 3.0)
           when coalesce(py,0) > 0 then round(coalesce(py,0) / 12.0)
           else null end as mavg
    from agg
  )
  update public.drugs d set
    prev_year_usage = c.py,
    recent_3m_usage = c.r3,
    monthly_avg  = coalesce(c.mavg, d.monthly_avg),
    safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end,
    max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
    usage_source = 'auto'
  from calc c
  where d.drug_code = c.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');
  get diagnostics v_count = row_count;

  -- (A2) 신규: (A)에서 빠진(출고 없음) 또는 manual 스킵된 약품 중 safety_stock 미설정 건을
  --      컬럼 폴백으로 채운다. 컬럼(prev_year/recent_3m)·usage_source 무변경, 빈 값만, mavg>0만.
  update public.drugs d set
    monthly_avg  = fb.mavg,
    safety_stock = ceil(fb.mavg * 1.2),
    max_stock    = round(fb.mavg * 3)
  from (
    select dd.drug_code,
      case
        when coalesce(txa.r3,0) > 0 then round(coalesce(txa.r3,0) / 3.0)
        when coalesce(txa.py,0) > 0 then round(coalesce(txa.py,0) / 12.0)
        when coalesce(dd.prev_year_usage,0) > 0 then round(coalesce(dd.prev_year_usage,0) / 12.0)
        when coalesce(dd.recent_3m_usage,0) > 0 then round(coalesce(dd.recent_3m_usage,0) / 3.0)
        else null
      end as mavg
    from public.drugs dd
    left join (
      select t.drug_code,
        sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
        sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
      from public.transactions t
      where t.type = '출고'
      group by t.drug_code
    ) txa on txa.drug_code = dd.drug_code
    where dd.status in ('사용','휴면')
      and coalesce(dd.safety_stock, 0) <= 0
      and coalesce(dd.monthly_avg, 0) <= 0
  ) fb
  where d.drug_code = fb.drug_code
    and fb.mavg is not null
    and fb.mavg > 0;
  get diagnostics v_count2 = row_count;

  -- (B) recent_1m_usage: 최근 1개월 출고 합(없으면 0).
  --     ★ 0105: (A) 와 **글자 그대로 같은** manual 보호 줄을 더했다.
  --       0046·0047 은 「직전1개월은 출고 사실」이라는 전제로 manual 게이트를 일부러 뺐는데,
  --       2026-08-07 PR #177 이 업로드 양식에 직전1개월 열을 더하면서 그 전제가 깨졌다.
  --       지금 업무 규칙은 「수기가 정본」이므로 수기 값을 지킨다.
  update public.drugs d set
    recent_1m_usage = coalesce(sub.r1, 0)
  from (
    select d2.drug_code, ag.r1
    from public.drugs d2
    left join (
      select t.drug_code, sum(t.quantity) as r1
      from public.transactions t
      where t.type = '출고'
        and t.transaction_date >= current_date - interval '1 month'
      group by t.drug_code
    ) ag on ag.drug_code = d2.drug_code
  ) sub
  where d.drug_code = sub.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');

  return v_count + v_count2;
end
$$;

commit;

-- ═══════════════════════════════════════════════════════════════════
-- 확인 (읽기 전용 — 함수를 **실행하지 않는다**)
-- ═══════════════════════════════════════════════════════════════════
--   select p.proname,
--          pg_get_functiondef(p.oid) ~ 'owner.., .admin'       as 넓혀졌나,
--          pg_get_functiondef(p.oid) ~ '최고 관리자'            as 옛문구남았나,
--          pg_get_functiondef(p.oid) ~ 'session_user'          as 예외조건_그대로,
--          pg_get_functiondef(p.oid) ~ 'current_user'          as 위험한_current_user
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prokind='f'
--      and p.proname in ('enforce_usage_edit_owner','app_recompute_usage');
--   → 넓혀졌나 t · 옛문구남았나 f · 예외조건_그대로 t · 위험한_current_user f

-- ═══════════════════════════════════════════════════════════════════
-- 되돌리기 (참고 — 실행하지 않음)
-- ═══════════════════════════════════════════════════════════════════
--   supabase/migrations/0105_usage_owner_guard.sql 의 두 함수
--   (enforce_usage_edit_owner · app_recompute_usage)를 그대로 다시 실행하면
--   owner 단독·옛 문구로 돌아간다. 감사표·CHECK·트리거 배선은 건드리지 않으므로 안전하다.
