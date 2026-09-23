import { supabase } from './supabase'
import type { ExtractedPage } from './pdf'

export const BUCKET = 'lease-files'
export const MAX_FILE_BYTES = 50 * 1024 * 1024

export type FileStatus = 'processing' | 'analyzing' | 'analyzed' | 'completed' | 'failed'

export type LeaseFile = {
  id: string
  file_name: string
  storage_path: string
  page_count: number
  is_scanned: boolean
  ocr_pages: number
  status: FileStatus
  error: string | null
  created_at: string
  processed_at: string | null
}

export type DocType =
  | 'main_lease'
  | 'amendment'
  | 'addendum'
  | 'extension'
  | 'assignment'
  | 'sublease'
  | 'guaranty'
  | 'other'

export type Lease = {
  id: string
  file_id: string
  parent_id: string | null
  doc_type: DocType
  title: string
  page_start: number
  page_end: number
  storage_path: string | null
  effective_date: string | null
  landlord: string | null
  tenant: string | null
  premises: string | null
  summary: string | null
  abstract: Record<string, string | null>
  created_at: string
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  main_lease: 'Main lease',
  amendment: 'Amendment',
  addendum: 'Addendum',
  extension: 'Extension',
  assignment: 'Assignment',
  sublease: 'Sublease',
  guaranty: 'Guaranty',
  other: 'Other',
}

export const ABSTRACT_LABELS: Record<string, string> = {
  landlord: 'Landlord',
  tenant: 'Tenant',
  premises_address: 'Premises',
  rentable_area: 'Rentable area',
  commencement_date: 'Commencement',
  expiration_date: 'Expiration',
  term: 'Term',
  base_rent: 'Base rent',
  rent_escalations: 'Rent escalations',
  security_deposit: 'Security deposit',
  renewal_options: 'Renewal options',
  termination_options: 'Termination options',
  permitted_use: 'Permitted use',
  operating_expenses: 'Operating expenses',
  changes_made: 'Changes made',
}

export type Stage =
  | { stage: 'extracting'; page: number; pageCount: number; ocr: boolean }
  | { stage: 'uploading' }
  | { stage: 'analyzing' }
  | { stage: 'splitting'; done: number; total: number }

const POLL_INTERVAL_MS = 3000
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000

async function currentUserId() {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('You are signed out. Log in and try again.')
  return data.user.id
}

const folderOf = (storagePath: string) => storagePath.slice(0, storagePath.lastIndexOf('/'))

async function markFailed(fileId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  await supabase.from('lease_files').update({ status: 'failed', error: message }).eq('id', fileId)
}

async function savePages(fileId: string, pages: ExtractedPage[]) {
  const rows = pages.map((p) => ({ file_id: fileId, ...p }))
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('lease_file_pages').upsert(rows.slice(i, i + 100))
    if (error) throw new Error(error.message)
  }
}

/** Full pipeline for a new upload: extract/OCR -> store -> AI analysis -> split. */
export async function uploadLeaseFile(file: File, onStage: (s: Stage) => void): Promise<void> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only PDF files are supported.')
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('PDF must be 50 MB or smaller.')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const { extractPdfText } = await import('./pdf')
  const pages = await extractPdfText(bytes, (p) => onStage({ stage: 'extracting', ...p }))

  onStage({ stage: 'uploading' })
  const userId = await currentUserId()
  const fileId = crypto.randomUUID()
  const storagePath = `${userId}/${fileId}/original.pdf`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: 'application/pdf' })
  if (uploadError) throw new Error(uploadError.message)

  const ocrPages = pages.filter((p) => p.is_ocr).length
  const { error: insertError } = await supabase.from('lease_files').insert({
    id: fileId,
    file_name: file.name,
    storage_path: storagePath,
    page_count: pages.length,
    is_scanned: ocrPages > 0,
    ocr_pages: ocrPages,
    status: 'processing',
  })
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath])
    throw new Error(insertError.message)
  }

  try {
    await savePages(fileId, pages)
    await analyzeAndSplit(fileId, storagePath, bytes, onStage)
  } catch (err) {
    await markFailed(fileId, err)
    throw err
  }
}

/** Re-runs whatever did not finish for a file (text extraction, analysis and/or splitting). */
export async function retryLeaseFile(file: LeaseFile, onStage: (s: Stage) => void): Promise<void> {
  try {
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storage_path)
    if (error) throw new Error(error.message)
    const bytes = new Uint8Array(await blob.arrayBuffer())

    const { count } = await supabase
      .from('lease_file_pages')
      .select('*', { count: 'exact', head: true })
      .eq('file_id', file.id)
    if (!count || count < file.page_count) {
      const { extractPdfText } = await import('./pdf')
      const pages = await extractPdfText(bytes, (p) => onStage({ stage: 'extracting', ...p }))
      await savePages(file.id, pages)
    }

    if (file.status === 'analyzed') await splitAndStore(file.id, file.storage_path, bytes, onStage)
    else await analyzeAndSplit(file.id, file.storage_path, bytes, onStage)
  } catch (err) {
    await markFailed(file.id, err)
    throw err
  }
}

async function analyzeAndSplit(fileId: string, storagePath: string, bytes: Uint8Array, onStage: (s: Stage) => void) {
  onStage({ stage: 'analyzing' })
  const { error } = await supabase.functions.invoke('analyze-lease', { body: { fileId } })
  if (error) {
    let detail = error.message
    try {
      detail = (await error.context.json()).error ?? detail
    } catch {
      // Not a JSON error response; keep the generic message.
    }
    throw new Error(`Could not start analysis: ${detail}`)
  }

  // The function runs in the background; wait for it to report back.
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const { data, error: pollError } = await supabase
      .from('lease_files')
      .select('status, error')
      .eq('id', fileId)
      .single()
    if (pollError) throw new Error(pollError.message)
    if (data.status === 'analyzed') break
    if (data.status === 'failed') throw new Error(data.error ?? 'Analysis failed.')
    if (Date.now() > deadline) throw new Error('Analysis timed out. Use Retry to try again.')
  }

  await splitAndStore(fileId, storagePath, bytes, onStage)
}

/** Writes one PDF per detected document and marks the file completed. */
async function splitAndStore(fileId: string, storagePath: string, bytes: Uint8Array, onStage: (s: Stage) => void) {
  const { data: leases, error } = await supabase
    .from('leases')
    .select('id, page_start, page_end')
    .eq('file_id', fileId)
    .order('page_start')
  if (error) throw new Error(error.message)

  // Clear split files from any earlier run.
  const folder = folderOf(storagePath)
  const { data: existing } = await supabase.storage.from(BUCKET).list(folder)
  const stale = (existing ?? []).filter((o) => o.name !== 'original.pdf').map((o) => `${folder}/${o.name}`)
  if (stale.length) await supabase.storage.from(BUCKET).remove(stale)

  const { data: fileRow } = await supabase.from('lease_files').select('page_count').eq('id', fileId).single()
  const pageCount = fileRow?.page_count ?? 0
  const wholeFile = leases.length === 1 && leases[0].page_start === 1 && leases[0].page_end >= pageCount

  if (wholeFile) {
    // Nothing to split: the document is the original upload.
    await supabase.from('leases').update({ storage_path: storagePath }).eq('id', leases[0].id)
  } else {
    const { splitPdf } = await import('./pdf')
    const parts = await splitPdf(bytes, leases.map((l) => ({ start: l.page_start, end: l.page_end })))
    for (let i = 0; i < leases.length; i++) {
      onStage({ stage: 'splitting', done: i, total: leases.length })
      const path = `${folder}/${leases[i].id}.pdf`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, parts[i], { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error(upErr.message)
      const { error: updErr } = await supabase.from('leases').update({ storage_path: path }).eq('id', leases[i].id)
      if (updErr) throw new Error(updErr.message)
    }
  }

  const { error: doneErr } = await supabase
    .from('lease_files')
    .update({ status: 'completed', error: null, processed_at: new Date().toISOString() })
    .eq('id', fileId)
  if (doneErr) throw new Error(doneErr.message)
}

export async function deleteLeaseFile(file: LeaseFile) {
  const folder = folderOf(file.storage_path)
  const { data: objects } = await supabase.storage.from(BUCKET).list(folder)
  const paths = (objects ?? []).map((o) => `${folder}/${o.name}`)
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
  const { error } = await supabase.from('lease_files').delete().eq('id', file.id)
  if (error) throw new Error(error.message)
}

export async function openStoredPdf(path: string) {
  // Open the tab synchronously so popup blockers allow it, then point it at the signed URL.
  const tab = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  if (error || !data) {
    tab?.close()
    throw new Error(error?.message ?? 'Could not open file.')
  }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

export async function fetchPageText(fileId: string, start: number, end: number) {
  const { data, error } = await supabase
    .from('lease_file_pages')
    .select('page_number, text, is_ocr')
    .eq('file_id', fileId)
    .gte('page_number', start)
    .lte('page_number', end)
    .order('page_number')
  if (error) throw new Error(error.message)
  return data as ExtractedPage[]
}
