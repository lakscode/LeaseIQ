import type { Lease } from './leases'

const DAY_MS = 24 * 60 * 60 * 1000

/** Abstract values are quoted as written ("December 31, 2030", "12/31/2030", "2030-12-31"). */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time)
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export const daysFromToday = (d: Date) =>
  Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / DAY_MS)

const latest = (dates: Array<Date | null>) => {
  const valid = dates.filter((d) => d !== null)
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : null
}

/** Latest expiration stated by any of the documents (a main lease and its amendments, extensions…). */
export const latestExpiration = (docs: Lease[]) => latest(docs.map((l) => parseDate(l.abstract?.expiration_date)))

export type LeaseTerm = {
  main: Lease
  /** Expiration after every amendment and extension. */
  expiration: Date | null
  /** A linked document moved the expiration past the main lease's own date. */
  renewed: boolean
  status: 'active' | 'expired' | 'unknown'
  /** Active and expiring within the next 12 months. */
  expiringSoon: boolean
}

export function leaseTerms(leases: Lease[]): LeaseTerm[] {
  return leases
    .filter((l) => l.doc_type === 'main_lease')
    .map((main) => {
      const children = leases.filter((l) => l.parent_id === main.id)
      const original = parseDate(main.abstract?.expiration_date)
      const extended = latestExpiration(children)
      const expiration = latest([original, extended])
      const renewed = !!extended && (!original || extended > original)
      const days = expiration ? daysFromToday(expiration) : null
      return {
        main,
        expiration,
        renewed,
        status: days === null ? 'unknown' : days < 0 ? 'expired' : 'active',
        expiringSoon: days !== null && days >= 0 && days <= 365,
      }
    })
}
