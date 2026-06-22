import DrugListView from '../DrugListView'

/* 메인 약품관리 — 사용+휴면 (사용 우선 정렬), 휴면 '활성화' 1클릭. 중지는 아카이브로 분리. */
export default function DrugsPage() {
  return (
    <DrugListView
      title="약품관리"
      baseStatuses={['사용', '휴면']}
      statusOptions={['사용', '휴면']}
      rowAction="activate"
      showArchiveLink
    />
  )
}
