/* ══════════════════════════════════════════════════════════════════════════
   0136 — 「적용」·「출고 자동집계」에도 백신(ATC J07)·한외마약 제외를 넣는다
          (2026-11-15 이정화 님 승인)

   ★ 무엇이 문제였나
     백신·마약·향정은 자동 전환·자동집계 대상에서 빼기로 했는데(2026-11-14 결정),
     그 제외가 app_recompute_usage 의 **'normal' 갈래 한 곳에만** 있었다.
       · 'all' 갈래(「출고 자동집계」)  — 마약·향정만 뺐다. 한외마약·백신은 **안 뺐다**.
       · app_save_usage_bulk(「적용」) — 아무것도 안 뺐다.
     그래서 2026-11-14 16:24 UTC(한국 01:24) 「적용」 한 번에 **백신 7종**의
     사용량·안전재고·최대재고가 바뀌었다(drug_usage_audit 에 남아 있다).

   ★ 무엇을 바꾸나
     ① app_recompute_usage 'all' 갈래 세 곳(A · A2 · B)에
        한외마약·백신(J07) 제외를 더한다 — 'normal' 갈래와 **같은 잣대**가 된다.
     ② app_save_usage_bulk 은 **자동 저장(p_source='auto')일 때만** 넷을 뺀다.
        'manual'(사용량 업로드·재고현황 직접 저장)은 사람이 일부러 넣는 값이라 그대로 둔다.

   ★ 바꾸지 않는 것 — 'normal'·'narcotic' 갈래, 계산식, 반올림 꼬리 규칙,
     manual 보호, 반환값 모양. 아래 본문은 **운영에서 뜬 지금 정의 그대로**이고
     위 두 가지 제외 줄만 더했다.

   ★ 되돌리기 — 이 파일의 두 CREATE OR REPLACE 에서 「2026-11-15」 주석이 붙은
     and 줄들을 지우고 다시 실행하면 된다.
   ══════════════════════════════════════════════════════════════════════════ */

CREATE OR REPLACE FUNCTION public.app_recompute_usage(p_overwrite_manual boolean DEFAULT false, p_scope text DEFAULT 'all'::text, p_year integer DEFAULT NULL::integer, p_month integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_count  integer;
  v_count2 integer;
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_srole  text := session_user;                                    -- 접속한 롤 (SET ROLE 에 안 흔들린다)
  v_grole  text := coalesce(current_setting('role', true), 'none');  -- PostgREST 가 건 SET ROLE 결과
  v_mrole  text;
  v_m1_from date;
  v_m3_from date;
  v_to      date;                                                    -- **포함하지 않는다**
begin
  -- ⓐ 관리자 검사 — 0105·0105c 와 **글자 그대로 같은** 판정이다(바꾸지 않았다).
  --    예외는 service_role(JWT)·직접 접속한 관리 롤뿐이다.
  --    ★ 「auth.uid() is null 이면 통과」로 적지 않는다 — 그러면 로그인 안 한 사람까지 통과한다.
  --    ★ current_user 도 쓰지 않는다 — DEFINER 안에서 주인으로 바뀐다(트리거 쪽 주석 참조).
  if not (coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
          or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none')) then
    if not exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id in (select current_tenant_ids())
    ) then
      -- 0105c 와 같은 진단값 — 토큰·비밀값은 넣지 않는다. uid 는 앞 8자리만.
      select tm.role into v_mrole
        from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.tenant_id in (select current_tenant_ids())
       limit 1;
      raise exception '출고 자동집계는 관리자만 실행할 수 있습니다 [진단: uid=%, member_role=%, guc_role=%]',
        coalesce(left(auth.uid()::text, 8), '없음'),
        coalesce(v_mrole, '없음'),
        v_grole
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_scope is null or p_scope not in ('all', 'narcotic', 'normal') then
    raise exception '알 수 없는 대상 범위입니다(all · normal · narcotic 만 됩니다)'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ═══════════════════════════════════════════════════════════════════
  -- 마약·향정만 · 달력 기준 — 새 갈래
  -- ═══════════════════════════════════════════════════════════════════
  -- ═══ (N) 일반만 · **마감월 기준** ═══════════════════════════════════════
  --   마약 갈래와 **같은 창 셈법**을 쓴다(p_year·p_month 기준 3개월·1개월).
  --   다른 점은 **대상 범위**뿐이다 — 마약·향정·한외마약·백신(ATC J07)·수기는 뺀다.
  --   월평균 규칙은 (A) 와 같다: 창에 기록이 있는데 출고 0 이면 0,
  --   출고가 있는데 반올림이 0 이면 빈 값(= 기존 기준 유지).
  if p_scope = 'normal' then
    if p_year is null or p_month is null then
      raise exception '마감월(연·월)을 함께 주십시오' using errcode = 'invalid_parameter_value';
    end if;
    if p_month < 1 or p_month > 12 or p_year < 2000 or p_year > 2100 then
      raise exception '기준월이 올바르지 않습니다(%-%)', p_year, p_month
        using errcode = 'invalid_parameter_value';
    end if;

    v_m1_from := make_date(p_year, p_month, 1);
    v_m3_from := (v_m1_from - interval '2 months')::date;
    v_to      := (v_m1_from + interval '1 month')::date;    -- 이 날은 **포함하지 않는다**

    with tx as (
      select t.drug_code,
        coalesce(sum(t.quantity) filter (
          where t.transaction_date >= v_m1_from and t.transaction_date < v_to), 0) as m1,
        coalesce(sum(t.quantity) filter (
          where t.transaction_date >= v_m3_from and t.transaction_date < v_to), 0) as m3
      from public.transactions t
      where t.type = '출고'
        and t.transaction_date >= v_m3_from
        and t.transaction_date <  v_to
      group by t.drug_code
    ),
    snapN as (
      select upper(btrim(ms.drug_code)) code, count(*) n
        from public.monthly_snapshots ms
       where (ms.snap_year * 100 + ms.snap_month) in (
               select (snap_year * 100 + snap_month)
                 from public.monthly_snapshots
                where (snap_year * 100 + snap_month) <= (p_year * 100 + p_month)
                group by 1 order by 1 desc limit 3)
       group by 1
    ),
    calc as (
      select d.drug_code,
        coalesce(tx.m1, 0) as m1,
        coalesce(tx.m3, 0) as m3,
        case
          when coalesce(sn.n, 0) >= 3
            then case when coalesce(tx.m3, 0) = 0 then 0
                      else nullif(round(coalesce(tx.m3, 0) / 3.0), 0) end
          when coalesce(tx.m3, 0) > 0 then nullif(round(coalesce(tx.m3, 0) / 3.0), 0)
          when coalesce(d.prev_year_usage, 0) > 0 then round(coalesce(d.prev_year_usage, 0) / 12.0)
          else null end as mavg
      from public.drugs d
      left join tx on tx.drug_code = d.drug_code
      left join snapN sn on sn.code = upper(btrim(d.drug_code))
      /* ★ 범위 — 여기 네 줄이 전부다 */
      where d.status in ('사용', '휴면')
        and d.narcotic_type is distinct from '마약'
        and d.narcotic_type is distinct from '향정'
        and d.narcotic_type is distinct from '한외마약'
        and coalesce(d.atc_code, '') not like 'J07%'
        and (p_overwrite_manual or d.usage_source is distinct from 'manual')
    )
    update public.drugs d set
      recent_1m_usage = c.m1,
      recent_3m_usage = c.m3,
      monthly_avg  = coalesce(c.mavg, d.monthly_avg),
      safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end,
      max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
      usage_source = 'auto'
    from calc c
    where d.drug_code = c.drug_code
      /* 바뀌는 것이 없는 줄은 건드리지 않는다 — 감사표에 빈 줄이 쌓이지 않게 */
      and (d.recent_1m_usage is distinct from c.m1
        or d.recent_3m_usage is distinct from c.m3
        or d.monthly_avg    is distinct from coalesce(c.mavg, d.monthly_avg)
        or d.usage_source   is distinct from 'auto');
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  if p_scope = 'narcotic' then
    if p_year is null or p_month is null then
      raise exception '기준월(연·월)을 주셔야 합니다'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_month < 1 or p_month > 12 or p_year < 2000 or p_year > 2100 then
      raise exception '기준월이 올바르지 않습니다(%-%)', p_year, p_month
        using errcode = 'invalid_parameter_value';
    end if;

    v_m1_from := make_date(p_year, p_month, 1);
    v_m3_from := (v_m1_from - interval '2 months')::date;
    v_to      := (v_m1_from + interval '1 month')::date;    -- 이 날은 **포함하지 않는다**

    with tx as (
      select t.drug_code,
        coalesce(sum(t.quantity) filter (
          where t.transaction_date >= v_m1_from and t.transaction_date < v_to), 0) as m1,
        coalesce(sum(t.quantity) filter (
          where t.transaction_date >= v_m3_from and t.transaction_date < v_to), 0) as m3
      from public.transactions t
      where t.type = '출고'
        and t.transaction_date >= v_m3_from
        and t.transaction_date <  v_to
      group by t.drug_code
    ),
    calc as (
      select d.drug_code,
        coalesce(tx.m1, 0) as m1,
        coalesce(tx.m3, 0) as m3,
        /* ★ 기존 (A) 블록과 **같은 식**이다. 새로 만들지 않았다. */
        case when coalesce(tx.m3, 0) > 0 then round(coalesce(tx.m3, 0) / 3.0)
             when coalesce(d.prev_year_usage, 0) > 0 then round(coalesce(d.prev_year_usage, 0) / 12.0)
             else null end as mavg
      from public.drugs d
      left join tx on tx.drug_code = d.drug_code
      /* ★ 범위는 여기 한 줄뿐이다 — 한외마약은 들어오지 않는다(확정 업무 규칙 9) */
      where d.narcotic_type in ('마약', '향정')
    )
    update public.drugs d set
      recent_1m_usage = c.m1,
      recent_3m_usage = c.m3,
      monthly_avg  = coalesce(c.mavg, d.monthly_avg),
      safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end,
      max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
      /* ★ 'auto' 가 아니라 'manual' 이다 — 일반 자동집계가 못 덮게 보호를 유지한다(위 주석) */
      usage_source = 'manual'
    from calc c
    where d.drug_code = c.drug_code
      /* 바뀌는 것이 없는 줄은 건드리지 않는다 — 감사표에 빈 줄이 쌓이지 않게 */
      and (d.recent_1m_usage is distinct from c.m1
        or d.recent_3m_usage is distinct from c.m3
        or (c.mavg is not null and (
             d.monthly_avg  is distinct from c.mavg
          or d.safety_stock is distinct from ceil(c.mavg * 1.2)
          or d.max_stock    is distinct from round(c.mavg * 3)))
        or d.usage_source is distinct from 'manual');
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  -- ═══════════════════════════════════════════════════════════════════
  -- 아래는 **지금과 똑같다** — 한 글자도 바꾸지 않았다.
  -- ═══════════════════════════════════════════════════════════════════

  -- (A) recent_3m·prev_year·monthly_avg·safety·max: 출고 있는 약품만 갱신, manual 보존.
  with win3 as (
    /* 가장 최근 마감 3개월 — 재고현황 「N개월 사용량 0」과 **같은 잣대**를 쓴다 */
    select (snap_year * 100 + snap_month) ym
      from public.monthly_snapshots
     group by 1 order by 1 desc limit 3
  ),
  snap3 as (
    select upper(btrim(drug_code)) code, count(*) n
      from public.monthly_snapshots
     where (snap_year * 100 + snap_month) in (select ym from win3)
     group by 1
  ),
  agg as (
    select t.drug_code,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
    from public.transactions t
    where t.type = '출고'
    group by t.drug_code
  ),
  calc as (
    select a.drug_code,
      coalesce(a.py, 0) as py,
      coalesce(a.r3, 0) as r3,
      case
        /* ★★ 창에 **기록이 있는데**(마감 줄 3개 이상) 출고가 0 이면 **0** 이다.
             전년÷12 로 넘어가지 않는다 — 「3개월 사용량 0 이면 발주 대상 아님」과 맞춘다.
           ★ 마약·향정은 **빠진다** — 출고를 NIMS 로 따로 보므로 약플로 0 이
             「정말 안 썼다」를 뜻하지 않는다 (2026-11-14 이정화 님 결정). */
        when d.narcotic_type is distinct from '마약'
         and d.narcotic_type is distinct from '향정'
         and coalesce(s.n, 0) >= 3
          then case when coalesce(a.r3,0) = 0 then 0
                    else nullif(round(coalesce(a.r3,0) / 3.0), 0) end
        when coalesce(a.r3,0) > 0 then nullif(round(coalesce(a.r3,0) / 3.0), 0)
        when coalesce(a.py,0) > 0 then round(coalesce(a.py,0) / 12.0)
        else null end as mavg
    from agg a
    join public.drugs d on d.drug_code = a.drug_code
    left join snap3 s on s.code = upper(btrim(a.drug_code))
  )
  update public.drugs d set
    recent_3m_usage = c.r3,
    monthly_avg  = coalesce(c.mavg, d.monthly_avg),
    safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end,
    max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
    usage_source = 'auto'
  from calc c
  where d.drug_code = c.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual')
    /* ★★ 2026-11-15 이정화 님 승인 — 'normal' 갈래와 **같은 제외**를 여기에도 둔다.
         한외마약·백신(ATC J07)이 'all' 갈래(「출고 자동집계」)로 새고 있었다.
         2026-11-14 「적용」으로 백신 7종이 바뀐 것이 그 길이다. */
    and d.narcotic_type is distinct from '한외마약'
    and coalesce(d.atc_code, '') not like 'J07%';
  get diagnostics v_count = row_count;

  -- (A2) (A)에서 빠진(출고 없음) 또는 manual 스킵된 약품 중 safety_stock 미설정 건을
  --      컬럼 폴백으로 채운다. 컬럼·usage_source 무변경, 빈 값만, mavg>0만.
  update public.drugs d set
    monthly_avg  = fb.mavg,
    safety_stock = ceil(fb.mavg * 1.2),
    max_stock    = round(fb.mavg * 3)
  from (
    select dd.drug_code,
      case
        /* ★★ (A) 와 **같은 규칙** — 기록이 있는데 출고 0 이면 0 이다(전년으로 안 넘어감).
             마약·향정은 빠진다. */
        when dd.narcotic_type is distinct from '마약'
         and dd.narcotic_type is distinct from '향정'
         and coalesce(s2.n, 0) >= 3
          then case when coalesce(txa.r3,0) = 0 then 0
                    else nullif(round(coalesce(txa.r3,0) / 3.0), 0) end
        when coalesce(txa.r3,0) > 0 then nullif(round(coalesce(txa.r3,0) / 3.0), 0)
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
    left join (
      select upper(btrim(ms.drug_code)) code, count(*) n
        from public.monthly_snapshots ms
       where (ms.snap_year * 100 + ms.snap_month) in (
               select (snap_year * 100 + snap_month)
                 from public.monthly_snapshots group by 1 order by 1 desc limit 3)
       group by 1
    ) s2 on s2.code = upper(btrim(dd.drug_code))
    where dd.status in ('사용','휴면')
      and coalesce(dd.safety_stock, 0) <= 0
      and coalesce(dd.monthly_avg, 0) <= 0
      /* ★ 0118 — 여기 한 줄만 더했다. 수기로 정한 값을 덮지 않는다(2026-11-09). */
      and (p_overwrite_manual or dd.usage_source is distinct from 'manual')
      /* ★★ 2026-11-15 — (A2) 에도 같은 제외를 둔다 */
      and dd.narcotic_type is distinct from '한외마약'
      and coalesce(dd.atc_code, '') not like 'J07%'
  ) fb
  where d.drug_code = fb.drug_code
    and fb.mavg is not null
    and fb.mavg > 0;
  get diagnostics v_count2 = row_count;

  -- (B) recent_1m_usage: 최근 1개월 출고 합(없으면 0). 0105 의 manual 보호가 걸려 있다.
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
    and (p_overwrite_manual or d.usage_source is distinct from 'manual')
    /* ★★ 2026-11-15 이정화 님 승인 — 'normal' 갈래와 **같은 제외**를 여기에도 둔다.
         한외마약·백신(ATC J07)이 'all' 갈래(「출고 자동집계」)로 새고 있었다.
         2026-11-14 「적용」으로 백신 7종이 바뀐 것이 그 길이다. */
    and d.narcotic_type is distinct from '한외마약'
    and coalesce(d.atc_code, '') not like 'J07%';

  return v_count + v_count2;
end
$function$
;

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
      /* ★★ 2026-11-15 이정화 님 승인 — **자동 저장일 때만** 마약·향정·한외마약·백신을 뺀다.
           · 'auto' = 기준확인 화면의 「적용」 → 자동 집계와 같은 길이므로 같은 제외를 쓴다.
           · 'manual' = 사용량 업로드·재고현황 직접 저장 → **사람이 일부러 넣는 값**이라 그대로 둔다
             (마약·향정 사용량은 NIMS 기준으로 손입력한다 — 2026-11-04 확정).
         2026-11-14 01:24 「적용」으로 백신 7종이 바뀐 것을 막는다. */
      and (v_src is distinct from 'auto' or (
            d.narcotic_type is distinct from '마약'
        and d.narcotic_type is distinct from '향정'
        and d.narcotic_type is distinct from '한외마약'
        and coalesce(d.atc_code, '') not like 'J07%'))
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
        /* ★ ② 0 으로 만드는 길에도 같은 제외 — 자동 저장일 때만 */
        and (v_src is distinct from 'auto' or (
              d.narcotic_type is distinct from '마약'
          and d.narcotic_type is distinct from '향정'
          and d.narcotic_type is distinct from '한외마약'
          and coalesce(d.atc_code, '') not like 'J07%'))
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
end $function$
;
