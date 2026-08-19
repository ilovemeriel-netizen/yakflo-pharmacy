-- 0066_swap_atc_slots_rpc.sql
-- 목적: ATC 카세트 슬롯 교환/이동을 서버 트랜잭션(원자적)으로 처리하는 RPC.
--   · p_pairs: [{slot_a, slot_b}...] — 각 쌍의 atc_slot을 맞교환(한쪽 빈 칸이면 단순 이동).
--   · 권한: owner/admin만. atc_pinned 품목 포함 쌍은 Phase1에서 실패 수집 → 1건↑이면 전량 미실행.
--   · UNIQUE(tenant_id,atc_slot) 위반 방지: 쌍별 임시 NULL 경유. 부분 실패 시 함수 전체 롤백(원자성).
--   · drugs.atc_slot만 변경(단가·수량 무관). updated_at은 0056 트리거로 자동.
--   · SECURITY DEFINER · search_path=public. dryrun 후 apply.
create or replace function public.swap_atc_slots(p_pairs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_tenant uuid; it jsonb; v_a text; v_b text; v_da text; v_db text;
  v_pa boolean; v_pb boolean; v_fail jsonb := '[]'::jsonb; v_done int := 0;
begin
  select tenant_id into v_tenant from public.tenant_members where user_id = auth.uid() limit 1;
  if v_tenant is null then raise exception 'tenant 확인 불가(로그인 필요)'; end if;
  if not exists(select 1 from public.tenant_members where user_id = auth.uid() and tenant_id = v_tenant and role in ('owner','admin')) then
    raise exception '권한 없음(owner/admin 전용)';
  end if;
  -- Phase1 검증(상비 고정 포함 차단)
  for it in select value from jsonb_array_elements(p_pairs) loop
    v_a := it->>'slot_a'; v_b := it->>'slot_b';
    select atc_pinned into v_pa from public.drugs where tenant_id = v_tenant and atc_slot = v_a;
    select atc_pinned into v_pb from public.drugs where tenant_id = v_tenant and atc_slot = v_b;
    if coalesce(v_pa,false) or coalesce(v_pb,false) then
      v_fail := v_fail || jsonb_build_array(jsonb_build_object('slot_a',v_a,'slot_b',v_b,'reason','상비 고정 품목 포함'));
    end if;
  end loop;
  if jsonb_array_length(v_fail) > 0 then
    return jsonb_build_object('ok', false, 'done', 0, 'failed', v_fail);
  end if;
  -- Phase2 적용(임시 NULL 경유)
  for it in select value from jsonb_array_elements(p_pairs) loop
    v_a := it->>'slot_a'; v_b := it->>'slot_b';
    select drug_code into v_da from public.drugs where tenant_id = v_tenant and atc_slot = v_a;
    select drug_code into v_db from public.drugs where tenant_id = v_tenant and atc_slot = v_b;
    update public.drugs set atc_slot = null where tenant_id = v_tenant and atc_slot in (v_a, v_b);
    if v_da is not null then update public.drugs set atc_slot = v_b where tenant_id = v_tenant and drug_code = v_da; end if;
    if v_db is not null then update public.drugs set atc_slot = v_a where tenant_id = v_tenant and drug_code = v_db; end if;
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('ok', true, 'done', v_done, 'failed', '[]'::jsonb);
end $function$;
grant execute on function public.swap_atc_slots(jsonb) to authenticated;
-- 롤백(참고): drop function if exists public.swap_atc_slots(jsonb);
