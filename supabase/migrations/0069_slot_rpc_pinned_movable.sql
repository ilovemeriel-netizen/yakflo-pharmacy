-- 0069_slot_rpc_pinned_movable.sql
-- 목적: atc_pinned 의미 변경 반영 — assign/clear에서 상비 이동/제거 허용(경고는 UI). FSP(FSP2·4·5)만 서버 고정.
--   · assign_atc_slot: FSP2·4·5 고정 슬롯·점유만 차단. 상비 품목/슬롯 차단 제거(상비 이동 허용).
--   · clear_atc_slot: FSP2·4·5 고정 슬롯·빈 슬롯만 차단. 상비 슬롯(1·2·3 등) 제거 허용(경고 후 진행은 UI).
--   · owner/admin 전용, 임시NULL 불필요(단일 UPDATE). 실패 시 {ok:false,reason}. 0068 함수 대체(create or replace).
create or replace function public.assign_atc_slot(p_code text, p_slot text)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_tenant uuid; v_is_fsp boolean; v_occ text;
begin
  select tenant_id into v_tenant from public.tenant_members where user_id = auth.uid() limit 1;
  if v_tenant is null then raise exception 'tenant 확인 불가(로그인 필요)'; end if;
  if not exists(select 1 from public.tenant_members where user_id = auth.uid() and tenant_id = v_tenant and role in ('owner','admin')) then raise exception '권한 없음(owner/admin 전용)'; end if;
  v_is_fsp := p_slot like 'FSP%';
  if v_is_fsp and p_slot in ('FSP2','FSP4','FSP5') then return jsonb_build_object('ok',false,'reason','고정 FSP(0.5T) 슬롯'); end if;
  if v_is_fsp then select drug_code into v_occ from public.drugs where tenant_id = v_tenant and fsp_slot = p_slot;
  else select drug_code into v_occ from public.drugs where tenant_id = v_tenant and atc_slot = p_slot; end if;
  if v_occ is not null then return jsonb_build_object('ok',false,'reason','이미 배정('||v_occ||')'); end if;
  if v_is_fsp then update public.drugs set fsp_slot = p_slot where tenant_id = v_tenant and drug_code = p_code;
  else update public.drugs set atc_slot = p_slot where tenant_id = v_tenant and drug_code = p_code; end if;
  return jsonb_build_object('ok',true);
end $function$;
create or replace function public.clear_atc_slot(p_slot text)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_tenant uuid; v_is_fsp boolean; v_occ text;
begin
  select tenant_id into v_tenant from public.tenant_members where user_id = auth.uid() limit 1;
  if v_tenant is null then raise exception 'tenant 확인 불가(로그인 필요)'; end if;
  if not exists(select 1 from public.tenant_members where user_id = auth.uid() and tenant_id = v_tenant and role in ('owner','admin')) then raise exception '권한 없음(owner/admin 전용)'; end if;
  v_is_fsp := p_slot like 'FSP%';
  if v_is_fsp and p_slot in ('FSP2','FSP4','FSP5') then return jsonb_build_object('ok',false,'reason','고정 FSP(0.5T) 슬롯'); end if;
  if v_is_fsp then select drug_code into v_occ from public.drugs where tenant_id = v_tenant and fsp_slot = p_slot;
  else select drug_code into v_occ from public.drugs where tenant_id = v_tenant and atc_slot = p_slot; end if;
  if v_occ is null then return jsonb_build_object('ok',false,'reason','빈 슬롯'); end if;
  if v_is_fsp then update public.drugs set fsp_slot = null where tenant_id = v_tenant and fsp_slot = p_slot;
  else update public.drugs set atc_slot = null where tenant_id = v_tenant and atc_slot = p_slot; end if;
  return jsonb_build_object('ok',true);
end $function$;
grant execute on function public.assign_atc_slot(text, text) to authenticated;
grant execute on function public.clear_atc_slot(text) to authenticated;
