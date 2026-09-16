import { launchChromium } from './browser.js';
import { writeFileSync } from 'fs';

export async function htmlToPdf(html, opts = {}) {
  const {
    paper = 'a4',
    landscape = false,
    printBackground = true,
    attachments = [],
    metadata = {},
    outPath,
  } = opts;

  const format = String(paper).toLowerCase();
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });

    const subject = metadata.subject || '';
    const buffer = await page.pdf({
      format,
      landscape: !!landscape,
      printBackground,
      margin: { top: '24mm', right: '18mm', bottom: '20mm', left: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `<div style="font-family: -apple-system, sans-serif; font-size: 9px; color: #888; width: 100%; padding: 0 18mm; display: flex; justify-content: space-between;"><span>designlang${subject ? ' · ' + escapeHtml(subject) : ''}</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });

    if (attachments.length) {
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(buffer);
      if (metadata.title) pdfDoc.setTitle(metadata.title);
      if (metadata.subject) pdfDoc.setSubject(metadata.subject);
      pdfDoc.setAuthor('designlang');
      pdfDoc.setCreator('designlang');
      for (const a of attachments) {
        await pdfDoc.attach(a.contents, a.filename, {
          mimeType: a.mimeType || 'application/json',
          description: a.description || a.filename,
        });
      }
      writeFileSync(outPath, await pdfDoc.save());
    } else {
      writeFileSync(outPath, buffer);
    }
  } finally {
    await browser.close();
  }
  return outPath;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
