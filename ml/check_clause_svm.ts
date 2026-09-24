// Checks the TypeScript clause classifier against scores from scikit-learn.
//   python ml/clause_svm.py export && node ml/check_clause_svm.ts
import { readFileSync } from 'node:fs'
import { loadClauseModel, scoreClause } from '../supabase/functions/analyze-lease/clause_svm.ts'

const model = loadClauseModel(JSON.parse(readFileSync(new URL('../supabase/functions/analyze-lease/clause_model.json', import.meta.url), 'utf8')))
const fixture: Array<{ text: string; scores: number[] }> = JSON.parse(readFileSync(new URL('./models/clause_svm_fixture.json', import.meta.url), 'utf8'))

let worst = 0
for (const { text, scores } of fixture) {
  const ts = scoreClause(model, text)
  scores.forEach((s, k) => (worst = Math.max(worst, Math.abs(s - ts[k]))))
}
console.log(`${fixture.length} samples, max score difference ${worst.toExponential(2)}`)
if (worst > 1e-3) process.exit(1)
