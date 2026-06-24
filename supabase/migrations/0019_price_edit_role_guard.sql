-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0019 단가 컬럼 편집 권한 강제 (BEFORE UPDATE 트리거) — 가역
-- 실행: Supabase Management API. CREATE OR REPLACE(재실행 안전).
--
-- 배경(보안 부채 高): drugs_update_own_tenant(RLS UPDATE)에 역할 제약 없음 → 테넌트 멤버 누구나 단가 변경 가능.
--   RLS는 행 단위라 '단가 컬럼만' 조건부 차단 불가(WITH CHECK는 OLD 비교 불가) → BEFORE UPDATE 트리거로 강제.
-- 효과: purchase_price·edi_price·price_unit 변경 시 owner/admin(tenant_members.role 또는 profiles.role='admin')만 허용.
--   그 외 컬럼(재고 인라인·유효기한 메모·약품정보) UPDATE는 member도 기존대로 가능(부작용 0).
-- ▶ SECURITY DEFINER: tenant_members/profiles를 RLS 무관 조회. auth.uid()=현재 로그인 사용자.
-- ════════════════════════════════════════════════════════════════

create or replace function public.enforce_price_edit_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 단가 컬럼이 실제로 변경된 경우에만 권한 검사(미변경 저장은 무영향)
  if (new.purchase_price is distinct from old.purchase_price
      or new.edi_price       is distinct from old.edi_price
      or new.price_unit      is distinct from old.price_unit) then
    if not (
      exists (select 1 from public.tenant_members tm
                where tm.user_id = auth.uid()
                  and tm.tenant_id = new.tenant_id
                  and tm.role in ('owner','admin'))
      or exists (select 1 from public.profiles pr
                   where pr.id = auth.uid() and pr.role = 'admin')
    ) then
      raise exception '단가 수정 권한이 없습니다 (owner/admin 전용)'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_price_edit_role on public.drugs;
create trigger trg_enforce_price_edit_role
  before update on public.drugs
  for each row execute function public.enforce_price_edit_role();

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- drop trigger if exists trg_enforce_price_edit_role on public.drugs;
-- drop function if exists public.enforce_price_edit_role();
-- ════════════════════════════════════════════════════════════════