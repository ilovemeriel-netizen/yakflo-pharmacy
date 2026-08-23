-- 0076_shared_ref_rls.sql
-- 목적: 공유 레퍼런스 6개(RLS off + anon·authenticated CRUD 전권 = 익명 쓰기 가능) 상태를
--   drug_master(0041)·holidays(0075)의 검증된 패턴으로 정렬.
--   · anon 전면 회수, authenticated는 SELECT만, 쓰기는 service_role(RLS 우회)만.
--   · RLS on + SELECT 정책 1종(authenticated, using true). 쓰기 정책 없음.
--   · 대상 6개 모두 0행·src 참조 0건 → 읽기 회귀 위험 없음. dryrun 통과 후 apply.
-- 대상(정확히 6개): drug_discontinuation, drug_harmful, drug_status_alerts,
--   dur_age_contraindication, dur_elderly_caution, dur_pregnancy_contraindication.

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'drug_discontinuation','drug_harmful','drug_status_alerts',
    'dur_age_contraindication','dur_elderly_caution','dur_pregnancy_contraindication'
  ]
  loop
    execute format('revoke all on public.%I from anon', t);                 -- anon 전부 회수(S/I/U/D)
    execute format('revoke all on public.%I from authenticated', t);        -- 초기화 후 SELECT만 재부여
    execute format('grant select on public.%I to authenticated', t);        -- authenticated 는 SELECT 전용
    execute format('grant all on public.%I to service_role', t);            -- 쓰기는 service_role(RLS 우회)
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_all', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select_all', t);
  end loop;
end $$;

commit;

-- 롤백(참고): 각 t에 대해
--   drop policy if exists <t>_select_all on public.<t>;
--   alter table public.<t> disable row level security;
--   grant all on public.<t> to anon, authenticated;   -- (원복 필요 시)
