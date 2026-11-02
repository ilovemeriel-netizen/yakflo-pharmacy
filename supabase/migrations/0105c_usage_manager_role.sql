-- 0105c_usage_manager_role.sql  ★ 초안 — **적용하지 않았다.**
--
-- 목적: 0105 가 걸어 둔 「최고 관리자(owner)만」을 「이 약국의 관리자(owner·admin)」로 넓힌다.
--       2026-11-02 이정화 님 결정 ① — 화면도 같은 기준(memberRole 이 owner 또는 admin)으로 맞췄다.
--
-- 왜 넓히나
--   · 0105 는 owner 한 사람만 통과시킨다. 그런데 화면은 admin 도 쓸 수 있게 하기로 했다.
--     그대로 두면 **화면에는 단추가 보이는데 누르면 거절**되는, 가장 헷갈리는 상태가 된다.
--   · 전역 프로필(profiles.role='admin')은 **넣지 않는다** — 그 사람은 이 약국의 멤버가 아니다.
--     판단 근거는 tenant_members 하나로만 둔다(화면도 같다).
--
-- ★ 적용 시점: 월마감이 끝난 뒤, 0105b 와 **함께**. 그 전에는 dryrun 도 하지 않는다.
-- ★ 바꾸는 것은 **누가 통과하느냐** 뿐이다 — 계산식·보호 범위·감사표는 한 글자도 건드리지 않는다.

begin;

-- ═══ 1) 사용량 칸 수정 권한: owner → owner·admin ═══
create or replace function public.enforce_usage_edit_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  -- ★ SECURITY DEFINER 안에서 current_user 는 함수 주인(postgres)으로 바뀐다.
  --   그걸로 관리자 여부를 보면 모두가 관리자로 보여 검사가 통째로 무력해진다(0105 에서 겪었다).
  v_srole text := session_user;
  v_grole text := coalesce(current_setting('role', true), 'none');
begin
  if not (new.prev_year_usage is distinct from old.prev_year_usage
       or new.recent_3m_usage is distinct from old.recent_3m_usage
       or new.recent_1m_usage is distinct from old.recent_1m_usage
       or new.monthly_avg     is distinct from old.monthly_avg
       or new.usage_source    is distinct from old.usage_source) then
    return new;
  end if;

  if coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
     or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none') then
    return new;
  end if;

  if not exists (
    select 1 from public.tenant_members tm
     where tm.user_id = auth.uid()
       and tm.tenant_id = new.tenant_id
       and tm.role in ('owner', 'admin')     -- ← 0105c: owner 단독에서 넓혔다
  ) then
    raise exception '사용량은 관리자만 수정할 수 있습니다'   -- ← 「최고 관리자」에서 바꿈
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

-- ═══ 2) 출고 자동집계 RPC: owner → owner·admin ═══
--    ★ (A)·(A2)·(B) 블록은 0105 정의를 **글자 그대로** 둔다. 바뀌는 것은 첫머리 검사뿐이다.
--    ※ 적용할 때는 0105 의 함수 전문을 그대로 복사해 오고, 아래 두 줄만 바꿀 것:
--        and tm.role = 'owner'            →  and tm.role in ('owner','admin')
--        '출고 자동집계는 최고 관리자만…'  →  '출고 자동집계는 관리자만 실행할 수 있습니다'
--      (여기에 전문을 또 적어 두면 0105 와 두 벌이 되어 한쪽만 고치는 사고가 난다.
--       0105 파일을 열어 복사하는 편이 안전하다 — 적용 전에 두 파일을 나란히 놓고 대조할 것.)

commit;

-- ═══ 확인 (읽기 전용) ═══
--   select pg_get_functiondef(p.oid) ~ 'owner.., .admin' as 넓혀졌나
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prokind='f'
--      and p.proname in ('enforce_usage_edit_owner','app_recompute_usage');

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   supabase/migrations/0105_usage_owner_guard.sql 의 해당 두 함수를 그대로 다시 실행하면
--   owner 단독으로 돌아간다. 감사표·CHECK·트리거 배선은 건드리지 않으므로 안전하다.
