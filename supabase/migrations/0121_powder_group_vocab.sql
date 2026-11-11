-- 0121_powder_group_vocab.sql   ★ 2026-11-11 운영 반영 완료 (dryrun → COMMIT → NOTIFY pgrst reload → API 확인)
--
-- 목적: 가루약 분리번호 **목록을 표로 옮긴다.** 번호를 늘리려고 코드를 고치지 않게.
--
-- 왜 (2026-11-11 이정화 님 결정)
--   지금 1~9 는 코드(`GROUP_NAMES`)와 제약(`CHECK 1~9`)에 **박혀 있다.**
--   10번(갑상선약)을 더하려면 코드를 고쳐 배포해야 한다. 앞으로도 그럴 것이다.
--   번호 목록을 표에 두면 **화면에서 더하고 이름을 바꾸고 숨길 수** 있다.
--
-- ★ 새 표를 만들지 않는다. 이미 있는 **`drug_vocab`**(공유 낱말 사전)에
--   `axis='powder_group'` 으로 넣는다. `code·label·sort_order·is_active·note` 가 그대로 쓸모 있다.
--   지금 `category·status·storage·narcotic_class` 따위가 같은 방식으로 들어 있다.
--
-- ★ `drug_vocab` 에는 `tenant_id` 가 없다 — **약국이 함께 쓰는 표**다.
--   쓰기는 `is_admin()` 만 (기존 정책 그대로, 이 파일에서 건드리지 않는다).
--
-- ★ 0119 의 `CHECK (group_no between 1 and 9)` 를 어떻게 바꾸나
--   ⓐ 외래키로 묶기 — `drug_vocab` 의 기본키가 `(axis, code)` 이고 `code` 는 **글자**다.
--      `group_no` 는 숫자라 그대로는 못 묶는다. 0119 의 칸 꼴을 바꾸는 것은 범위가 크다.
--   ⓑ CHECK 안에서 다른 표를 보기 — PostgreSQL 이 **막는다**(CHECK 에 조회를 못 쓴다).
--      함수로 감싸면 문법은 통과하지만, 뒤에 목록이 바뀌어도 **다시 검사하지 않아** 믿을 수 없다.
--   ⓒ **이 파일이 고른 방법** — CHECK 는 **넉넉한 테두리(1~99)** 로만 두고,
--      「그 번호가 목록에 있고 켜져 있나」는 **트리거**가 넣을 때마다 본다.
--      트리거는 쓸 때마다 다시 보므로 목록이 바뀌어도 어긋나지 않는다.
--
-- ★ 숨긴 번호(is_active=false)로는 **새로 넣지 못한다.** 다만 이미 들어간 줄은 건드리지 않는다
--   — 숨기기는 「앞으로 안 쓴다」는 뜻이지 「지난 것을 지운다」는 뜻이 아니다.
--
-- ★ expand 순서 (CLAUDE.md): 표·제약을 먼저 바꾸고, PostgREST 캐시를 갱신해
--   API 에서 보이는지 확인한 뒤에야 이 표를 읽는 화면을 배포한다.

begin;

-- ═══ ① 번호 목록을 drug_vocab 에 넣는다 ═══
--   code 는 글자다(표의 꼴). 숫자 차례는 sort_order 로 잡는다 — '10' 이 '2' 보다 앞서지 않게.
insert into public.drug_vocab (axis, code, label, sort_order, is_active, note) values
  ('powder_group', '1',  '일반 정제',            1,  true, '가루약 조제 가능 약제'),
  ('powder_group', '2',  '혈압약/심장약',         2,  true, 'ATC C01~C09 (C10 고지혈증 제외)'),
  ('powder_group', '3',  '항혈전제',             3,  true, 'ATC B01 + 정'),
  ('powder_group', '4',  '변비약',               4,  true, 'ATC A06 · A02AA(마그네슘 제산제)'),
  ('powder_group', '5',  '당뇨약',               5,  true, 'ATC A10'),
  ('powder_group', '6',  '일반 캡슐제',           6,  true, '항혈전제(캡슐)를 뺀 일반 캡슐'),
  ('powder_group', '7',  '향정신성의약품',         7,  true, 'narcotic_type=향정'),
  ('powder_group', '8',  '항혈전제(캡슐)',         8,  true, 'ATC B01 + 캡슐'),
  ('powder_group', '9',  '그 외 분리 필요한 약제',  9,  true, 'd/c 잦은 약 — 손으로 정하거나 예외 ATC'),
  ('powder_group', '10', '갑상선약',             10, true, 'ATC H03 (2026-11-11 새로 만듦)')
on conflict (axis, code) do update
  set label = excluded.label,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      note = excluded.note;

-- ═══ ② 0119 의 번호 테두리를 넓힌다 ═══
--   1~9 → 1~99. 「어떤 번호가 쓸 수 있나」는 아래 트리거가 본다.
alter table public.drug_powder_override
  drop constraint if exists drug_powder_override_no_chk;
alter table public.drug_powder_override
  add constraint drug_powder_override_no_chk
  check (group_no between 1 and 99);

comment on column public.drug_powder_override.group_no is
  '사람이 정한 분리번호. 쓸 수 있는 번호는 drug_vocab(axis=powder_group) 가 정한다. 이 줄을 지우면 자동 계산으로 돌아간다.';

-- ═══ ③ 「그 번호가 목록에 있고 켜져 있나」를 넣을 때마다 본다 ═══
create or replace function public.assert_powder_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.drug_vocab v
     where v.axis = 'powder_group'
       and v.code = new.group_no::text
       and v.is_active
  ) then
    raise exception '쓸 수 없는 분리번호입니다: % — 번호 목록(drug_vocab.powder_group)에 없거나 숨긴 번호입니다.', new.group_no
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_assert_powder_group on public.drug_powder_override;
create trigger trg_assert_powder_group
  before insert or update of group_no on public.drug_powder_override
  for each row execute function public.assert_powder_group();

commit;

-- PostgREST 스키마 캐시 갱신 — 이 줄까지 돌려야 API 에서 새 줄이 보인다(CLAUDE.md 함정 #22).
notify pgrst, 'reload schema';

-- ═══ 확인 (읽기 전용) ═══
--   select code, label, sort_order, is_active from public.drug_vocab
--    where axis='powder_group' order by sort_order;        → 1~10 열 줄
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname='drug_powder_override_no_chk';          → CHECK 1~99
--   select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
--    where c.relname='drug_powder_override' and not t.tgisinternal;
--                                                          → trg_assert_powder_group 포함

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   drop trigger if exists trg_assert_powder_group on public.drug_powder_override;
--   drop function if exists public.assert_powder_group();
--   alter table public.drug_powder_override drop constraint if exists drug_powder_override_no_chk;
--   alter table public.drug_powder_override add constraint drug_powder_override_no_chk
--     check (group_no between 1 and 9);
--   delete from public.drug_vocab where axis='powder_group';
--   ⚠ 10번으로 적어 둔 줄이 있으면 **되돌리기 전에** 1~9 로 옮기거나 지워야 한다
--     (1~9 테두리로 돌아가면 그 줄이 제약에 걸린다).
