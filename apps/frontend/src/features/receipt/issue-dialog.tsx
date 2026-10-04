// The issue detail and its thread: the store and the dispatcher read the same record. No Figma
// frame draws it (specs/receipt/spec.md, Scope), so it reuses the M4 dialog's layout.
import {
  getIssuesCommentsQueryKey,
  getIssuesGetQueryKey,
  getIssuesListQueryKey,
  useIssuesComment,
  useIssuesComments,
  useIssuesGet,
  useIssuesPhoto,
  useIssuesReopen,
  useIssuesResolve,
  type IssueDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Dialog, DialogContent, DialogHeader } from '@/ui/dialog'
import { RadioCards } from '@/ui/radio-cards'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Textarea } from '@/ui/textarea'
import { ISSUE_STATUS_WORDS, ISSUE_TYPE_WORDS, issueTone, RESOLUTION_WORDS } from './receipt-copy'

export interface IssueDialogProps {
  id: string
  onClose: () => void
}

const RESOLUTIONS = ['CREDIT_ISSUED', 'CREDIT_REQUESTED', 'REDELIVERY', 'NO_ACTION'] as const
type Resolution = (typeof RESOLUTIONS)[number]

const ROLE_WORDS: Record<string, string> = { store_manager: 'Store', dispatcher: 'Dispatcher', driver: 'Driver', admin: 'Admin' }

/**
 * One issue and its thread. Each action shows only while the issue carries its link: the
 * dispatcher resolves while it is open, the store reopens for 48 hours after (AC-RCP-13, 14), and
 * either posts to the thread (AC-RCP-12).
 */
export function IssueDialog({ id, onClose }: IssueDialogProps) {
  const queryClient = useQueryClient()
  const read = useIssuesGet(id)
  const thread = useIssuesComments(id)
  const comment = useIssuesComment()
  const resolve = useIssuesResolve()
  const reopen = useIssuesReopen()
  const [body, setBody] = useState('')
  const [resolution, setResolution] = useState<Resolution | undefined>()
  const [note, setNote] = useState('')
  const issue = read.data?.data

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getIssuesGetQueryKey(id) })
    void queryClient.invalidateQueries({ queryKey: getIssuesListQueryKey() })
  }

  const post = async () => {
    await comment.mutateAsync({ id, data: { body: body.trim() } })
    setBody('')
    void queryClient.invalidateQueries({ queryKey: getIssuesCommentsQueryKey(id) })
  }

  const close = async () => {
    if (!resolution) return
    await resolve.mutateAsync({ id, data: { resolution, ...(note.trim() ? { note: note.trim() } : {}) } })
    setNote('')
    refresh()
  }

  const reopenIt = async () => {
    await reopen.mutateAsync({ id })
    refresh()
  }

  const resolveLink = getLink(issue?._links, 'resolve')
  const reopenLink = getLink(issue?._links, 'reopen')
  const commentLink = getLink(issue?._links, 'comment')
  const comments = thread.data?.data ?? []

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[520px] max-w-[calc(100vw-2rem)]">
        <DialogHeader
          title={issue ? `Issue · ${ISSUE_TYPE_WORDS[issue.type] ?? issue.type}` : 'Issue'}
          description={issue ? `Order #${issue.orderNo ?? '—'}` : undefined}
        />
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-5 pb-5 pt-4">
          {read.isError ? (
            <ErrorState error={read.error} onRetry={() => void read.refetch()} />
          ) : !issue ? (
            <Skeleton className="h-[320px] w-full" />
          ) : (
            <>
              <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <StatusChip tone={issueTone(issue.status)}>{ISSUE_STATUS_WORDS[issue.status] ?? issue.status}</StatusChip>
                  {issue.qtyAffected !== null ? <span className="type-body-small text-muted-foreground">{issue.qtyAffected} affected</span> : null}
                  <span className="type-body-small ml-auto text-muted-foreground">
                    {ROLE_WORDS[issue.raisedByRole] ?? issue.raisedByRole} · {formatColombo(issue.createdAt, 'EEE d MMM, HH:mm')}
                  </span>
                </div>
                <p className="type-body m-0 rounded-md border border-border bg-page px-3.5 py-3 text-foreground">{issue.description}</p>
                {issue.photos.length > 0 ? (
                  <div className="flex gap-2">
                    {issue.photos.map((p) => (
                      <IssuePhoto key={p.id} issueId={issue.id} photoId={p.id} />
                    ))}
                  </div>
                ) : null}
                {issue.status === 'RESOLVED' && issue.resolution ? (
                  <p className="type-body-medium m-0 font-bold text-foreground">
                    {RESOLUTION_WORDS[issue.resolution] ?? issue.resolution}
                    {issue.resolutionNote ? <span className="font-normal text-muted-foreground"> · {issue.resolutionNote}</span> : null}
                  </p>
                ) : null}
              </section>

              <section aria-label="Thread" className="flex flex-col gap-2 border-t border-border pt-4">
                <h3 className="type-label m-0 uppercase text-muted-foreground">Thread</h3>
                {thread.isError ? (
                  <ErrorState error={thread.error} onRetry={() => void thread.refetch()} />
                ) : thread.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : comments.length === 0 ? (
                  <EmptyState title="No comments yet" description="The store and the dispatcher talk about it here." />
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="flex flex-col gap-0.5 rounded-md border border-border px-3.5 py-2.5">
                      <span className="type-body-small text-muted-foreground">
                        {c.authorName ?? ROLE_WORDS[c.authorRole] ?? c.authorRole} · {ROLE_WORDS[c.authorRole] ?? c.authorRole} ·{' '}
                        {formatColombo(c.createdAt, 'EEE d MMM, HH:mm')}
                      </span>
                      <p className="type-body m-0 whitespace-pre-wrap text-foreground">{c.body}</p>
                    </div>
                  ))
                )}
                {commentLink ? (
                  <div className="flex flex-col gap-2">
                    <Textarea aria-label="Comment" rows={2} maxLength={1000} placeholder="Add to the thread" value={body} onChange={(e) => setBody(e.target.value)} />
                    <Action link={commentLink} variant="outline" disabled={body.trim() === ''} onAction={post}>
                      Send
                    </Action>
                  </div>
                ) : null}
                {comment.isError ? <ErrorState error={comment.error} /> : null}
              </section>

              {resolveLink ? (
                <section aria-label="Resolve" className="flex flex-col gap-2 border-t border-border pt-4">
                  <h3 className="type-card-title m-0 text-foreground">Resolve this issue</h3>
                  <RadioCards<Resolution>
                    aria-label="Resolution"
                    value={resolution}
                    onValueChange={setResolution}
                    options={RESOLUTIONS.map((r) => ({ value: r, label: RESOLUTION_WORDS[r] }))}
                  />
                  <Textarea aria-label="Resolution note" rows={2} placeholder="What was done, for the store" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Action link={resolveLink} variant="default" disabled={!resolution} onAction={close}>
                    Resolve issue
                  </Action>
                  {resolve.isError ? <ErrorState error={resolve.error} /> : null}
                </section>
              ) : null}

              {reopenLink ? (
                <section className="flex flex-col gap-2 border-t border-border pt-4">
                  <p className="type-body m-0 text-muted-foreground">Not sorted? You can reopen this within 48 hours of it being resolved.</p>
                  <Action link={reopenLink} variant="outline" onAction={reopenIt}>
                    Reopen issue
                  </Action>
                  {reopen.isError ? <ErrorState error={reopen.error} /> : null}
                </section>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** An issue photo, opened through a link good for five minutes. */
function IssuePhoto({ issueId, photoId }: { issueId: IssueDto['id']; photoId: string }) {
  const link = useIssuesPhoto(issueId, photoId)
  const url = link.data?.data.url
  if (!url) return <Skeleton className="size-20" />
  return <img src={url} alt="Issue photo" className="size-20 rounded-md border border-border object-cover" />
}
