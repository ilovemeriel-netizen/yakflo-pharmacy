-- 0068_assign_clear_atc_slot.sql
-- 목적: ATC 슬롯 수기 배정/제거 RPC(원자적). 고정 6(상비 슬롯1·2·3 + FSP2·4·5) 차단.
--   assign_atc_slot(p_code,p_slot): 빈 슬롯에 배정(FSP*=fsp_slot, 그 외=atc_slot). 상비 품목·고정 슬롯·점유 슬롯 차단.
--   clear_atc_slot(p_slot): 슬롯 비우기. 고정 슬롯·빈 슬롯 차단.
--   owner/admin 전용. UNIQUE(tenant_id,atc_slot|fsp_slot) 위반은 점유 확인으로 사전 차단. 실패 시 {ok:false,reason}.
create or replace function public.assign_atc_slot(p_code text, p_slot text)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_tenant uuid; v_is_fsp boolean; v_occ text; v_pinned boolean;
begin
  select tenant_id into v_tenant from public.tenant_members where user_id = auth.uid() limit 1;
  if v_tenant is null then raise exception 'tenant 확인 불가(로그인 필요)'; end if;
  if not exists(select 1 from public.tenant_members where user_id = auth.uid() and tenant_id = v_tenant and role in ('owner','admin')) then raise exception '권한 없음(owner/admin 전용)'; end if;
  v_is_fsp := p_slot like 'FSP%';
  select atc_pinned into v_pinned from public.drugs where tenant_id = v_tenant and drug_code = p_code;
  if coalesce(v_pinned,false) then return jsonb_build_object('ok',false,'reason','상비 고정 품목'); end if;
  if v_is_fsp and p_slot in ('FSP2','FSP4','FSP5') then return jsonb_build_object('ok',false,'reason','고정 FSP(0.5T) 슬롯'); end if;
  if (not v_is_fsp) and p_slot in ('1','2','3') then return jsonb_build_object('ok',false,'reason','상비 고정 슬롯'); end if;
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
  if (not v_is_fsp) and p_slot in ('1','2','3') then return jsonb_build_object('ok',false,'reason','상비 고정 슬롯'); end if;
  if v_is_fsp then select drug_code into v_occ from public.drugs where tenant_id = v_tenant and fsp_slot = p_slot;
  else select drug_code into v_occ from public.drugs where tenant_id = v_tenant and atc_slot = p_slot; end if;
  if v_occ is null then return jsonb_build_object('ok',false,'reason','빈 슬롯'); end if;
  if v_is_fsp then update public.drugs set fsp_slot = null where tenant_id = v_tenant and fsp_slot = p_slot;
  else update public.drugs set atc_slot = null where tenant_id = v_tenant and atc_slot = p_slot; end if;
  return jsonb_build_object('ok',true);
end $function$;
grant execute on function public.assign_atc_slot(text, text) to authenticated;
grant execute on function public.clear_atc_slot(text) to authenticated;
-- 롤백(참고): drop function if exists public.assign_atc_slot(text,text); drop function if exists public.clear_atc_slot(text);
