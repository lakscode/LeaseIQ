import * as pdfjs from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'
import type { FileLogger } from './logger'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// A page with fewer non-whitespace characters than this has no usable text
// layer, i.e. it is a scanned image and needs OCR.
const MIN_TEXT_CHARS = 25
const OCR_RENDER_SCALE = 2

export type ExtractedPage = { page_number: number; text: string; is_ocr: boolean }

export type ExtractProgress = { page: number; pageCount: number; ocr: boolean }

const elapsed = (start: number) => Math.round(performance.now() - start)

/** Extracts the text of every page, running OCR on pages that have no text layer. */
export async function extractPdfText(
  bytes: Uint8Array,
  log: FileLogger,
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractedPage[]> {
  const started = performance.now()
  log.info('extract', 'Opening PDF with pdf.js', { bytes: bytes.length })

  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
  const pdf = await loadingTask.promise
  log.info('extract', `PDF opened: ${pdf.numPages} page(s)`, { pages: pdf.numPages, ms: elapsed(started) })

  const pages: ExtractedPage[] = []
  let ocrWorker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null = null

  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const pageStarted = performance.now()
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      let text = content.items
        .map((item) => {
          const t = item as TextItem
          return t.str + (t.hasEOL ? '\n' : ' ')
        })
        .join('')
        .trim()

      const textLayerChars = text.replace(/\s/g, '').length
      const needsOcr = textLayerChars < MIN_TEXT_CHARS
      onProgress?.({ page: n, pageCount: pdf.numPages, ocr: needsOcr })

      if (needsOcr) {
        log.info('ocr', `Page ${n}: no usable text layer (${textLayerChars} chars), running OCR`, { page: n, textLayerChars })
        if (!ocrWorker) {
          const workerStarted = performance.now()
          log.info('ocr', 'Starting tesseract.js OCR worker (downloads language data on first use)')
          const { createWorker } = await import('tesseract.js')
          ocrWorker = await createWorker('eng')
          log.info('ocr', 'OCR worker ready', { ms: elapsed(workerStarted) })
        }
        const viewport = page.getViewport({ scale: OCR_RENDER_SCALE })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvas, viewport }).promise
        const { data } = await ocrWorker.recognize(canvas)
        text = data.text.trim()
        canvas.width = canvas.height = 0
        log.info('ocr', `Page ${n}: OCR produced ${text.length} chars`, {
          page: n,
          chars: text.length,
          confidence: Math.round(data.confidence),
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
          ms: elapsed(pageStarted),
        })
        if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
          log.warn('ocr', `Page ${n}: OCR found little or no text (blank page or poor scan)`, { page: n })
        }
      } else {
        log.info('extract', `Page ${n}: ${text.length} chars from text layer`, { page: n, chars: text.length, ms: elapsed(pageStarted) })
      }

      pages.push({ page_number: n, text, is_ocr: needsOcr })
      page.cleanup()
    }
  } catch (err) {
    log.error('extract', `Text extraction failed at page ${pages.length + 1}`, {
      page: pages.length + 1,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    if (ocrWorker) {
      await ocrWorker.terminate()
      log.info('ocr', 'OCR worker stopped')
    }
    await loadingTask.destroy()
  }

  const ocrCount = pages.filter((p) => p.is_ocr).length
  log.info('extract', `Extraction finished: ${pages.length} page(s), ${ocrCount} via OCR`, {
    pages: pages.length,
    ocrPages: ocrCount,
    totalChars: pages.reduce((sum, p) => sum + p.text.length, 0),
    ms: elapsed(started),
  })
  return pages
}

/** Splits a PDF into several PDFs, one per inclusive 1-based page range. */
export async function splitPdf(
  bytes: Uint8Array,
  ranges: Array<{ start: number; end: number }>,
  log: FileLogger,
): Promise<Uint8Array[]> {
  const started = performance.now()
  log.info('split', `Loading PDF with pdf-lib to split into ${ranges.length} part(s)`)
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const results: Uint8Array[] = []
  for (const [i, { start, end }] of ranges.entries()) {
    const out = await PDFDocument.create()
    const indices = Array.from({ length: end - start + 1 }, (_, k) => start - 1 + k)
    const copied = await out.copyPages(source, indices)
    copied.forEach((p) => out.addPage(p))
    const saved = await out.save()
    log.info('split', `Part ${i + 1}: pages ${start}-${end} (${saved.length} bytes)`, { part: i + 1, start, end, bytes: saved.length })
    results.push(saved)
  }
  log.info('split', 'PDF split finished', { parts: results.length, ms: elapsed(started) })
  return results
}
