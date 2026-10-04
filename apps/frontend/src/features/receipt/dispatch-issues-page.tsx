// No Figma frame: the dispatcher's list of store issues (specs/receipt/spec.md, Scope). It reuses
// the deferral log's table and the issue dialog; alerts' "Open the issue" link leads to a row here.
import { useIssuesList } from '@compass/api-client'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { SegmentedControl } from '@/ui/segmented-control'
import { IssueDialog } from './issue-dialog'
import { IssuesTable } from './issues-table'

type Tab = 'open' | 'resolved'

const OPEN = 'OPEN,IN_PROGRESS'

/** Store issues for the dispatcher's depots: work the open ones, look back at the resolved. */
export function DispatchIssuesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('open')
  const open = useIssuesList({ 'filter[status]': OPEN, limit: 1 })
  const resolved = useIssuesList({ 'filter[status]': 'RESOLVED', limit: 1 })
  usePageHeader({ eyebrow: 'Issues', title: 'Issues' })

  return (
    <div className="flex flex-col gap-4">
      <HeaderActions>
        <SegmentedControl<Tab>
          aria-label="Issues"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'open', label: 'Open', count: open.data?.meta.page.total ?? 0 },
            { value: 'resolved', label: 'Resolved', count: resolved.data?.meta.page.total ?? 0 },
          ]}
        />
      </HeaderActions>
      <IssuesTable
        key={tab}
        status={tab === 'open' ? OPEN : 'RESOLVED'}
        emptyTitle={tab === 'open' ? 'No open issues' : 'Nothing resolved yet'}
        emptyDescription={tab === 'open' ? 'When a store reports a problem with a delivery, it shows here.' : 'Issues you resolve show here.'}
        onOpen={(issue) => void navigate(`/dispatch/issues/${issue.id}`)}
      />
      {id ? <IssueDialog id={id} onClose={() => void navigate('/dispatch/issues')} /> : null}
    </div>
  )
}
