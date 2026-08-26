-- 0077_guard_profiles_role_direct.sql
-- 목적: profiles.role 직접 변경 차단 — role 변경은 관리자(is_admin)만. 일반 사용자의 자기 role 자가승격(권한 상승) 방지.
--   · 배경: profiles_update_own(USING auth.uid()=id)에 WITH CHECK가 없어 사용자가 자기 role을 변경 가능.
--     RLS WITH CHECK는 OLD 값을 참조할 수 없어 role만 정밀 차단 불가(role='user' 고정식은 admin의 settings update까지 막음)
--     → BEFORE UPDATE 가드 트리거로만 해결(0055 current_qty 가드와 동일 패턴).
--   · 차단 조건: NEW.role IS DISTINCT FROM OLD.role AND current_user='authenticated' AND NOT public.is_admin()
--     → 일반 인증 사용자(authenticated)의 role 변경만 차단.
--       service_role(관리 스크립트·네이버 콜백)·postgres(마이그레이션)·anon·관리자(is_admin=true)는 current_user≠'authenticated' 또는 is_admin으로 통과.
--   · role 이외 컬럼(settings·email·full_name 등) update와 INSERT(가입 시 handle_new_user)는 무영향
--     (BEFORE UPDATE + role 변경 조건이므로 즐겨찾기/컬럼 설정 self-update, 신규 가입 프로필 생성 모두 통과).
--   · dryrun 필수(BEGIN → 검증 → ROLLBACK). 본 파일 apply 미실행(승인 후 별도 적용).

create or replace function public.guard_profiles_role_direct()
returns trigger language plpgsql as $function$
begin
  if new.role is distinct from old.role
     and current_user = 'authenticated'
     and not public.is_admin() then
    raise exception 'profiles.role 직접 변경 차단 — role 변경은 관리자만 가능합니다 (id=%, % → %)',
      new.id, old.role, new.role using errcode = 'check_violation';
  end if;
  return new;
end $function$;

drop trigger if exists trg_guard_profiles_role_direct on public.profiles;
create trigger trg_guard_profiles_role_direct
  before update on public.profiles
  for each row execute function public.guard_profiles_role_direct();

-- 롤백(참고):
-- drop trigger if exists trg_guard_profiles_role_direct on public.profiles;
-- drop function if exists public.guard_profiles_role_direct();
