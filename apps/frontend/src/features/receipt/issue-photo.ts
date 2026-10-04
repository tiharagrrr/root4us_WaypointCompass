import { issuesCompletePhoto, issuesPresign } from '@compass/api-client'

/**
 * Puts one photo on an issue: ask for somewhere to put it, PUT the file straight to the store
 * (it never passes through the API), then confirm it arrived (AC-RCP-10). The client UUID makes
 * a retry of the first step return the same attachment.
 */
export async function uploadIssuePhoto(issueId: string, file: File): Promise<void> {
  const contentType = file.type || 'image/jpeg'
  const presigned = await issuesPresign(issueId, {
    contentType,
    bytes: file.size,
    clientUuid: globalThis.crypto.randomUUID(),
  })
  const { id, uploadUrl } = presigned.data
  if (uploadUrl) {
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: file })
    if (!put.ok) throw new Error(`The photo did not upload (${put.status})`)
  }
  await issuesCompletePhoto(issueId, id)
}
