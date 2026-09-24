"""Classify lease clauses with a linear SVM over TF-IDF word uni/bigrams.

Data: every .xlsx in src/test_data has two unlabelled columns, the clause text
and a fastText-style label (``__label__<id>``). Files ending in ``test_data``
are held out for evaluation; everything else is training data. Display names
for label ids come from ml/clause_labels.csv (edit it, then re-run ``export``);
ids missing from it are named after their single-category training file, or
keep their raw id.

    python ml/clause_svm.py train                 # tune, evaluate, save model
    python ml/clause_svm.py predict "Tenant shall pay ..."
    python ml/clause_svm.py predict --file clauses.txt   # one clause per line
    python ml/clause_svm.py export                # JSON model for the analyze-lease Edge Function

The exported model is scored in TypeScript (supabase/functions/analyze-lease/
clause_svm.ts), so clean() and the vectorizer settings must stay in sync with
that file. Word features only: character n-grams added <1 point of accuracy
but made the exported model ~20x larger.
"""

import argparse
import base64
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.svm import LinearSVC

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / 'src' / 'test_data'
OUT_DIR = Path(__file__).resolve().parent / 'models'
MODEL_PATH = OUT_DIR / 'clause_svm.joblib'
REPORT_PATH = OUT_DIR / 'clause_svm_report.json'
LABELS_PATH = Path(__file__).resolve().parent / 'clause_labels.csv'
EXPORT_PATH = ROOT / 'supabase' / 'functions' / 'analyze-lease' / 'clause_model.json'


def clean(text: str) -> str:
    # The spreadsheets mix encodings (curly quotes show up as mojibake), so
    # drop anything outside ASCII after normalising.
    text = unicodedata.normalize('NFKC', text)
    text = re.sub(r'[^\x00-\x7f]', ' ', text)
    return re.sub(r'\s+', ' ', text).strip().lower()


def load_data(data_dir: Path) -> pd.DataFrame:
    rows = []
    for path in sorted(data_dir.glob('*.xlsx')):
        for sheet in pd.read_excel(path, sheet_name=None, header=None).values():
            if sheet.shape[1] < 2:
                continue
            for text, label in zip(sheet[0], sheet[1]):
                rows.append((path.stem, text, str(label).strip().removeprefix('__label__')))
    df = pd.DataFrame(rows, columns=['file', 'text', 'label'])
    df = df[df.text.notna() & (df.label != 'label')]  # 'label' is a stray header row
    df['clean'] = df.text.astype(str).map(clean)
    df = df[df.clean != '']
    df['is_test'] = df.file.str.endswith('test_data')
    return df


def label_names(df: pd.DataFrame) -> dict[str, str]:
    train = df[~df.is_test]
    per_file = train.groupby('file').label.agg(['nunique', 'first'])
    names: dict[str, list[str]] = {}
    for file, row in per_file[per_file['nunique'] == 1].iterrows():
        names.setdefault(row['first'], []).append(file)
    named = {label: ' / '.join(files) for label, files in names.items()}
    named.update(label_overrides())
    missing = sorted(set(df.label) - set(named))
    if missing:
        print(f'warning: no name for {len(missing)} label id(s), add them to {LABELS_PATH.name}: {missing}')
    return {label: named.get(label, label) for label in df.label.unique()}


def label_overrides() -> dict[str, str]:
    if not LABELS_PATH.exists():
        return {}
    with LABELS_PATH.open(encoding='utf-8', newline='') as f:
        return {row['label_id']: row['name'].strip() for row in csv.DictReader(f) if row['name'].strip()}


def build_model(C: float = 1.0):
    features = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, max_features=20_000)
    return make_pipeline(features, LinearSVC(C=C))


def train(args):
    df = load_data(Path(args.data))
    names = label_names(df)
    tr = df[~df.is_test].drop_duplicates(['clean', 'label'])
    te = df[df.is_test]
    print(f'train: {len(tr)} clauses, {tr.label.nunique()} labels | test: {len(te)} clauses, {te.label.nunique()} labels')

    # Tune C on the training set only; classes with < 3 examples can't be
    # stratified, so they are left out of the search but kept for the final fit.
    counts = tr.label.value_counts()
    cv_set = tr[tr.label.isin(counts[counts >= 3].index)]
    search = GridSearchCV(
        build_model(), {'linearsvc__C': [0.3, 1.0, 3.0]},
        cv=StratifiedKFold(3, shuffle=True, random_state=0), scoring='f1_macro', n_jobs=-1,
    )
    search.fit(cv_set.clean, cv_set.label)
    C = search.best_params_['linearsvc__C']
    print(f'best C={C} (cv macro-F1 {search.best_score_:.3f})')

    model = build_model(C).fit(tr.clean, tr.label)
    scores = model.decision_function(te.clean)
    ranked = model.classes_[np.argsort(-scores, axis=1)]
    pred = ranked[:, 0]
    y = te.label.to_numpy()
    report = {
        'C': C,
        'train_size': len(tr),
        'test_size': len(te),
        'accuracy': accuracy_score(y, pred),
        'macro_f1': f1_score(y, pred, average='macro'),
        'top3_accuracy': float(np.mean([y[i] in ranked[i, :3] for i in range(len(y))])),
        'accuracy_by_file': te.assign(ok=pred == y).groupby('file').ok.mean().round(3).to_dict(),
        'per_label': classification_report(
            [names[l] for l in y], [names[l] for l in pred], output_dict=True, zero_division=0,
        ),
    }
    print(f"test accuracy {report['accuracy']:.3f} | macro-F1 {report['macro_f1']:.3f} | top-3 {report['top3_accuracy']:.3f}")
    for file, acc in report['accuracy_by_file'].items():
        print(f'  {file}: {acc:.3f}')

    # Refit on all data (train + test) for the saved model unless told not to.
    if not args.no_refit:
        model = build_model(C).fit(df.drop_duplicates(['clean', 'label']).clean, df.drop_duplicates(['clean', 'label']).label)
    OUT_DIR.mkdir(exist_ok=True)
    joblib.dump({'model': model, 'names': names}, MODEL_PATH)
    REPORT_PATH.write_text(json.dumps(report, indent=2))
    print(f'saved {MODEL_PATH.relative_to(ROOT)} and {REPORT_PATH.relative_to(ROOT)}')


def load_bundle():
    bundle = joblib.load(MODEL_PATH)
    return bundle['model'], {**bundle['names'], **label_overrides()}


def predict(args):
    model, names = load_bundle()
    texts = args.text or []
    if args.file:
        texts += [line for line in Path(args.file).read_text(encoding='utf-8').splitlines() if line.strip()]
    if not texts:
        sys.exit('give clause text or --file')
    scores = np.atleast_2d(model.decision_function([clean(t) for t in texts]))
    for text, row in zip(texts, scores):
        top = np.argsort(-row)[: args.top]
        print(json.dumps({
            'text': text[:120],
            'predictions': [{'label': names.get(model.classes_[i], model.classes_[i]), 'id': model.classes_[i], 'score': round(float(row[i]), 3)} for i in top],
        }))


def export(args):
    model, names = load_bundle()
    vectorizer, svm = model[0], model[-1]
    vocab = sorted(vectorizer.vocabulary_, key=vectorizer.vocabulary_.get)
    # Weights are quantised to int8 per class; this changes test accuracy by < 1 point.
    scale = np.abs(svm.coef_).max(axis=1) / 127
    weights = np.round(svm.coef_ / scale[:, None]).astype(np.int8)
    out = {
        'version': 1,
        'vocab': vocab,
        'idf': [round(float(v), 5) for v in vectorizer.idf_],
        'classes': list(svm.classes_),
        'names': [names.get(c, c) for c in svm.classes_],
        'intercept': [round(float(v), 6) for v in svm.intercept_],
        'scale': [float(v) for v in scale],
        'weights': base64.b64encode(weights.tobytes()).decode(),  # row-major: classes x vocab
    }
    EXPORT_PATH.write_text(json.dumps(out, separators=(',', ':')))
    print(f'exported {len(vocab)} features x {len(svm.classes_)} classes to {EXPORT_PATH.relative_to(ROOT)} '
          f'({EXPORT_PATH.stat().st_size / 1e6:.1f} MB)')

    # Reference scores for checking the TypeScript port against scikit-learn.
    samples = load_data(DATA_DIR).text.astype(str).sample(300, random_state=0).tolist()
    X = vectorizer.transform([clean(t) for t in samples])
    q = (X @ (weights * scale[:, None]).T) + svm.intercept_
    fixture = [{'text': t, 'scores': [round(float(v), 6) for v in row]} for t, row in zip(samples, np.asarray(q))]
    (OUT_DIR / 'clause_svm_fixture.json').write_text(json.dumps(fixture))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)
    t = sub.add_parser('train')
    t.add_argument('--data', default=str(DATA_DIR))
    t.add_argument('--no-refit', action='store_true', help='save the model trained without the test files')
    t.set_defaults(func=train)
    p = sub.add_parser('predict')
    p.add_argument('text', nargs='*')
    p.add_argument('--file')
    p.add_argument('--top', type=int, default=3)
    p.set_defaults(func=predict)
    sub.add_parser('export').set_defaults(func=export)
    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
