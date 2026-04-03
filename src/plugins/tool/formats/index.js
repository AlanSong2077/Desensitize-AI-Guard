/**
 * src/plugins/tool/formats/index.js — file format registry entry point
 *
 * Registers all built-in format handlers into the global registry.
 * To add a new format, import it here and call registry.register().
 */

import { registry }    from './FileFormat.js'
import { CsvFormat }   from './CsvFormat.js'
import { XlsxFormat }  from './XlsxFormat.js'
import { XlsFormat }   from './XlsFormat.js'
import { DocxFormat }  from './DocxFormat.js'
import { PptxFormat }  from './PptxFormat.js'
import { PdfFormat }   from './PdfFormat.js'

registry
  .register(new CsvFormat())
  .register(new XlsxFormat())
  .register(new XlsFormat())
  .register(new DocxFormat())
  .register(new PptxFormat())
  .register(new PdfFormat())

export { registry }
export { FileFormat, FileFormatRegistry }          from './FileFormat.js'
export { CsvFormat, parseCsvLine, toCsvField }     from './CsvFormat.js'
export { XlsxFormat }                              from './XlsxFormat.js'
export { XlsFormat }                               from './XlsFormat.js'
export { DocxFormat }                              from './DocxFormat.js'
export { PptxFormat }                              from './PptxFormat.js'
export { PdfFormat }                               from './PdfFormat.js'
