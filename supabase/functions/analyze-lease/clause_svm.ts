// Lease clause classifier: a linear SVM over TF-IDF word uni/bigrams, trained
// with scikit-learn by ml/clause_svm.py and exported to clause_model.json.
// clean() and vectorize() mirror TfidfVectorizer(ngram_range=(1, 2),
// sublinear_tf=True) exactly, so scores match the Python model.
//
// No Deno APIs here, so the parity check (ml/check_clause_svm.ts) can run on Node.

export type ClauseModelJson = {
  version: number
  vocab: string[]
  idf: number[]
  classes: string[]
  names: string[]
  intercept: number[]
  scale: number[]
  weights: string // base64 int8, row-major: classes x vocab
}

export type ClauseModel = {
  vocab: Map<string, number>
  idf: Float64Array
  classes: string[]
  names: string[]
  intercept: Float64Array
  scale: Float64Array
  weights: Int8Array
}

export type ClausePrediction = { labelId: string; label: string; score: number }

export type Clause = { index: number; page: number; text: string }

export function loadClauseModel(raw: ClauseModelJson): ClauseModel {
  const bytes = Uint8Array.from(atob(raw.weights), (c) => c.charCodeAt(0))
  const weights = new Int8Array(bytes.buffer)
  if (weights.length !== raw.classes.length * raw.vocab.length) throw new Error('Clause model weights have the wrong size')
  return {
    vocab: new Map(raw.vocab.map((term, i) => [term, i])),
    idf: Float64Array.from(raw.idf),
    classes: raw.classes,
    names: raw.names,
    intercept: Float64Array.from(raw.intercept),
    scale: Float64Array.from(raw.scale),
    weights,
  }
}

// Same as clean() in ml/clause_svm.py. Python's \s also matches \x1c-\x1f.
export function clean(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[^\x00-\x7f]/g, ' ')
    .replace(/[\s\x1c-\x1f]+/g, ' ')
    .trim()
    .toLowerCase()
}

function vectorize(model: ClauseModel, text: string): Map<number, number> {
  // scikit-learn's default token_pattern (?u)\b\w\w+\b; the text is ASCII after clean().
  const tokens = clean(text).match(/\b\w\w+\b/g) ?? []
  const counts = new Map<number, number>()
  const add = (term: string) => {
    const j = model.vocab.get(term)
    if (j !== undefined) counts.set(j, (counts.get(j) ?? 0) + 1)
  }
  for (let i = 0; i < tokens.length; i++) {
    add(tokens[i])
    if (i + 1 < tokens.length) add(`${tokens[i]} ${tokens[i + 1]}`)
  }
  let norm = 0
  for (const [j, c] of counts) {
    const v = (1 + Math.log(c)) * model.idf[j]
    counts.set(j, v)
    norm += v * v
  }
  norm = Math.sqrt(norm)
  if (norm > 0) for (const [j, v] of counts) counts.set(j, v / norm)
  return counts
}

export function scoreClause(model: ClauseModel, text: string): Float64Array {
  const x = vectorize(model, text)
  const V = model.vocab.size
  const scores = new Float64Array(model.classes.length)
  for (let k = 0; k < scores.length; k++) {
    let dot = 0
    const row = k * V
    for (const [j, v] of x) dot += model.weights[row + j] * v
    scores[k] = model.intercept[k] + model.scale[k] * dot
  }
  return scores
}

export function classifyClause(model: ClauseModel, text: string, top = 3): ClausePrediction[] {
  const scores = scoreClause(model, text)
  return [...scores.keys()]
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, top)
    .map((k) => ({ labelId: model.classes[k], label: model.names[k], score: Math.round(scores[k] * 1000) / 1000 }))
}

// ---------- Splitting a document into clauses ----------

// A clause starts at a numbered or titled heading, or after a blank line.
const HEADING = [
  /^(article|section)\s+[\divxlc]+\b/i, // ARTICLE 5, Section 10
  /^\d{1,3}(\.\d{1,3})*\.\s/, //           5. RENT, 10.02. Repairs
  /^\d{1,3}(\.\d{1,3})+\s/, //             10.02 - Tenant's Obligation
  /^\([a-z]{1,4}\)\s/, //                  (a), (iv)
  /^[a-z]\.\s/, //                          a. Lessee may sublet
]
const PAGE_NUMBER = /^(page\s+)?-?\s*\d{1,4}\s*-?(\s+of\s+\d{1,4})?$/i
const MIN_CHARS = 120 // shorter pieces are merged into a neighbouring clause
const MAX_CHARS = 4000 // longer ones are split at sentence ends

export function splitClauses(pages: Array<{ page_number: number; text: string }>): Clause[] {
  const pieces: Array<{ page: number; lines: string[] }> = []
  let current: { page: number; lines: string[] } | null = null
  let blank = false

  for (const page of pages) {
    for (const rawLine of page.text.split('\n')) {
      const line = rawLine.trim()
      if (!line) {
        blank = true
        continue
      }
      if (PAGE_NUMBER.test(line)) continue
      if (!current || blank || HEADING.some((re) => re.test(line))) {
        current = { page: page.page_number, lines: [] }
        pieces.push(current)
      }
      current.lines.push(line)
      blank = false
    }
  }

  // Short pieces that end a sentence belong with the clause before them (e.g. a
  // one-line "(b) ..." subclause); other short pieces are headings and belong
  // with the clause after them.
  const merged: Array<{ page: number; text: string }> = []
  let carry: { page: number; text: string } | null = null
  for (const piece of pieces) {
    const text = piece.lines.join(' ').replace(/\s+/g, ' ')
    const next: { page: number; text: string } = carry ? { page: carry.page, text: `${carry.text} ${text}` } : { page: piece.page, text }
    if (next.text.length >= MIN_CHARS) {
      merged.push(next)
      carry = null
    } else if (!carry && merged.length && /[.;:]["')\]]*$/.test(text)) {
      merged[merged.length - 1].text += ` ${text}`
    } else carry = next
  }
  if (carry) {
    if (merged.length) merged[merged.length - 1].text += ` ${carry.text}`
    else merged.push(carry)
  }

  const clauses: Clause[] = []
  for (const piece of merged) {
    for (const text of splitLong(piece.text)) clauses.push({ index: clauses.length, page: piece.page, text })
  }
  return clauses
}

function splitLong(text: string): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(MAX_CHARS / 2, MAX_CHARS)
    const m = [...window.matchAll(/[.;:]\s+(?=[A-Z(])/g)].pop()
    const cut = m ? MAX_CHARS / 2 + m.index! + 1 : MAX_CHARS
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}
