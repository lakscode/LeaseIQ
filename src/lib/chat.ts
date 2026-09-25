import { supabase } from './supabase'
import type { DocType } from './leases'

export type ChatSource = { leaseId: string; title: string; docType: DocType; page: number }

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  error?: boolean
}

/** Asks the lease-chat Edge Function; history is every earlier message in the conversation. */
export async function askLeaseQuestion(history: ChatMessage[], leaseId: string | null) {
  const messages = history.filter((m) => !m.error).map(({ role, content }) => ({ role, content }))
  const { data, error } = await supabase.functions.invoke('lease-chat', { body: { messages, leaseId } })
  if (error) {
    if (error.name === 'FunctionsFetchError') {
      throw new Error('Could not reach the "lease-chat" Edge Function. Make sure it is deployed to your Supabase project.')
    }
    // FunctionsHttpError carries the function's JSON error body in context.
    const body = await error.context?.json?.().catch(() => null)
    throw new Error(body?.error ?? error.message)
  }
  return data as { answer: string; sources: ChatSource[] }
}
