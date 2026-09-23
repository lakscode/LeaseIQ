import * as pdfjs from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// A page with fewer non-whitespace characters than this has no usable text
// layer, i.e. it is a scanned image and needs OCR.
const MIN_TEXT_CHARS = 25
const OCR_RENDER_SCALE = 2

export type ExtractedPage = { page_number: number; text: string; is_ocr: boolean }

export type ExtractProgress = { page: number; pageCount: number; ocr: boolean }

/** Extracts the text of every page, running OCR on pages that have no text layer. */
export async function extractPdfText(
  bytes: Uint8Array,
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractedPage[]> {
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
  const pdf = await loadingTask.promise
  const pages: ExtractedPage[] = []
  let ocrWorker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null = null

  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      let text = content.items
        .map((item) => {
          const t = item as TextItem
          return t.str + (t.hasEOL ? '\n' : ' ')
        })
        .join('')
        .trim()

      const needsOcr = text.replace(/\s/g, '').length < MIN_TEXT_CHARS
      onProgress?.({ page: n, pageCount: pdf.numPages, ocr: needsOcr })

      if (needsOcr) {
        if (!ocrWorker) {
          const { createWorker } = await import('tesseract.js')
          ocrWorker = await createWorker('eng')
        }
        const viewport = page.getViewport({ scale: OCR_RENDER_SCALE })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvas, viewport }).promise
        const { data } = await ocrWorker.recognize(canvas)
        text = data.text.trim()
        canvas.width = canvas.height = 0
      }

      pages.push({ page_number: n, text, is_ocr: needsOcr })
      page.cleanup()
    }
  } finally {
    await ocrWorker?.terminate()
    await loadingTask.destroy()
  }

  return pages
}

/** Splits a PDF into several PDFs, one per inclusive 1-based page range. */
export async function splitPdf(bytes: Uint8Array, ranges: Array<{ start: number; end: number }>): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const results: Uint8Array[] = []
  for (const { start, end } of ranges) {
    const out = await PDFDocument.create()
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i)
    const copied = await out.copyPages(source, indices)
    copied.forEach((p) => out.addPage(p))
    results.push(await out.save())
  }
  return results
}
