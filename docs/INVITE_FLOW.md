# 사용자 초대 동선 (self-가입 차단 후)

> `disable_signup=true` 적용으로 **self 회원가입은 차단**됨. 신규 직원은 **owner/admin이 생성·매핑**한다.
> 본 문서는 절차(서버) + 설정 화면 초대 UI **설계안**이다(UI 구현은 승인 후).

## A. 즉시 가능 — Admin API로 계정 생성 + 테넌트 매핑 (서버 전용)

> service_role 키는 **서버/로컬 전용**(프론트·커밋 금지). 아래는 owner가 1회 실행하는 서버 절차.

1) 계정 생성 (GoTrue Admin — 확정 상태로 즉시 로그인 가능):
```
POST https://phgkjrvdtcdrdiuigici.supabase.co/auth/v1/admin/users
Headers: apikey: <service_role>, Authorization: Bearer <service_role>
Body: { "email": "staff@hospital.kr", "password": "<임시>", "email_confirm": true }
```
2) 테넌트 매핑 (SQL — 역할 owner/admin/member):
```sql
insert into public.tenant_members (tenant_id, user_id, role)
select t.id, u.id, 'member'
from public.tenants t, auth.users u
where t.slug = 'cnc' and u.email = 'staff@hospital.kr'
on conflict (tenant_id, user_id) do update set role = excluded.role;
```
3) 비밀번호 전달: 임시 비번 직접 전달 후 첫 로그인, 또는 SMTP 설정 후 비밀번호 재설정 메일.

> 매핑 전에는 로그인돼도 RLS로 **데이터 0 접근**(안전). 역할은 `tenant_members.role`가 권한 기준
> (owner/admin = 삭제 허용, member = 삭제 거부 — 0010 적용 후 정상 동작).

## B. 권한 매트릭스 (현재 정책 기준)
| 동작 | member | admin/owner |
|---|---|---|
| 조회(같은 테넌트) | ✅ | ✅ |
| 입고/출고/반품/폐기(거래) | ✅(쓰기) | ✅ |
| drugs 삭제 | ❌ 거부 | ✅ 허용(0010 후) |
| transactions 삭제 | ❌ (정책 없음 = append-only) | ❌ (감사 무결성) |
| 타 테넌트 데이터 | ❌ 비노출 | ❌ 비노출 |

## C. 설정 > 사용자·권한 — 초대 UI 설계안 (구현 보류)
- `/app/settings` 내 '사용자·권한' 섹션 (owner/admin만 노출 — 권한 기반 조건부).
- 목록: `tenant_members` + `profiles`(email·이름·역할). 행별 역할 변경(member↔admin), 비활성.
- '직원 초대' 버튼 → 폼(email·역할) → **서버 함수(Netlify Function 또는 Supabase Edge Function)** 가
  service_role로 위 A 절차(계정 생성 + 매핑) 수행. **service_role은 서버 함수에만**, 프론트 미노출.
- 응답: 임시 비번(또는 초대 링크) 표시. SMTP 연동 시 초대 메일 자동 발송.
- 가산적: 기존 `/app` 라우트·화면 무영향. owner/admin 외에는 섹션 자체 숨김.

> 구현 시 신규 서버 함수(invite)·RLS(권한 체크)·UI를 단계 게이트로 추가하며, service_role 노출 0을 보장한다.