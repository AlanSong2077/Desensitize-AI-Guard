/**
 * src/plugins/tool/formats/XlsFormat.js — XLS 文件格式处理器
 *
 * 支持 BIFF8 二进制格式（.xls），纯 Node.js 实现，零外部依赖。
 * 提取文本单元格、数字单元格（NUMBER、RK、MULRK）和共享字符串（SST）。
 * 序列化时输出为 CSV。
 */

import { FileFormat } from './FileFormat.js'

export class XlsFormat extends FileFormat {
  get extensions()      { return ['.xls'] }
  get outputExtension() { return '.csv' }

  /**
   * 解析 XLS 文件
   * @param {Buffer} buffer
   * @returns {ParsedFile}
   */
  parse(buffer) {
    return parseXls(buffer)
  }
}

// ── OLE2 容器解析 ─────────────────────────────────────────────────────────────

function parseXls(buf) {
  const stream = extractOle2Stream(buf, 'Workbook') || extractOle2Stream(buf, 'Book')
  return parseBiff8(stream || buf)
}

function extractOle2Stream(buf, name) {
  if (buf.length < 8) return null
  if (buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) return null
  try {
    const ss           = 1 << buf.readUInt16LE(30)
    const mss          = 1 << buf.readUInt16LE(32)
    const fatCount     = buf.readUInt32LE(44)
    const firstDir     = buf.readUInt32LE(48)
    const miniCutoff   = buf.readUInt32LE(56)
    const firstMiniFat = buf.readUInt32LE(60)

    // 构建 FAT
    const fat = []
    for (let i = 0; i < Math.min(fatCount, 109); i++) {
      const sec = buf.readUInt32LE(76 + i * 4)
      if (sec >= 0xFFFFFFFD) break
      const off = (sec + 1) * ss
      for (let j = 0; j < ss / 4; j++) {
        if (off + j * 4 + 4 > buf.length) break
        fat.push(buf.readUInt32LE(off + j * 4))
      }
    }

    const readChain = (start, maxSize) => {
      const chunks = []
      let sec = start, total = 0
      while (sec < 0xFFFFFFFD && sec < fat.length) {
        const off = (sec + 1) * ss
        if (off >= buf.length) break
        const chunk = buf.slice(off, Math.min(off + ss, buf.length))
        chunks.push(chunk); total += chunk.length
        if (maxSize && total >= maxSize) break
        sec = fat[sec]
      }
      const r = Buffer.concat(chunks)
      return maxSize ? r.slice(0, maxSize) : r
    }

    // 读取目录流
    const dirStream = readChain(firstDir)
    const entries = []
    for (let i = 0; i + 128 <= dirStream.length; i += 128) {
      const nLen = dirStream.readUInt16LE(i + 64)
      if (!nLen || nLen > 64) continue
      entries.push({
        name:  dirStream.slice(i, i + nLen - 2).toString('utf16le'),
        type:  dirStream[i + 66],
        start: dirStream.readUInt32LE(i + 116),
        size:  dirStream.readUInt32LE(i + 120),
      })
    }

    const target = entries.find(e => e.name.toLowerCase() === name.toLowerCase() && e.type === 2)
    if (!target) return null

    // 小文件走 Mini Stream
    if (target.size < miniCutoff) {
      const root = entries.find(e => e.type === 5)
      if (!root) return null
      const miniStream = readChain(root.start)
      const miniFat = []
      let mfSec = firstMiniFat
      while (mfSec < 0xFFFFFFFD && mfSec < fat.length) {
        const off = (mfSec + 1) * ss
        for (let j = 0; j < ss / 4; j++) {
          if (off + j * 4 + 4 > buf.length) break
          miniFat.push(buf.readUInt32LE(off + j * 4))
        }
        mfSec = fat[mfSec]
      }
      const chunks = []
      let sec = target.start, total = 0
      while (sec < 0xFFFFFFFD && sec < miniFat.length) {
        const off = sec * mss
        if (off >= miniStream.length) break
        chunks.push(miniStream.slice(off, Math.min(off + mss, miniStream.length)))
        total += mss
        if (total >= target.size) break
        sec = miniFat[sec]
      }
      return Buffer.concat(chunks).slice(0, target.size)
    }
    return readChain(target.start, target.size)
  } catch { return null }
}

// ── BIFF8 解析 ────────────────────────────────────────────────────────────────

function readBiff8Str(buf, pos) {
  if (pos + 3 > buf.length) return { str: '', len: 0 }
  const charCount = buf.readUInt16LE(pos)
  const flags     = buf[pos + 2]
  const unicode   = flags & 1, richText = flags & 8, extData = flags & 4
  let off = pos + 3
  if (richText) off += 2
  if (extData)  off += 4
  const byteLen = unicode ? charCount * 2 : charCount
  if (off + byteLen > buf.length) return { str: '', len: off - pos + byteLen }
  const str = unicode
    ? buf.slice(off, off + byteLen).toString('utf16le')
    : buf.slice(off, off + byteLen).toString('latin1')
  return { str, len: off - pos + byteLen }
}

function decodeRk(rk) {
  let v
  if (rk & 2) { v = rk >> 2 } else {
    const t = Buffer.alloc(8)
    t.writeUInt32LE(rk & 0xFFFFFFFC, 4)
    v = t.readDoubleBE(0)
  }
  return rk & 1 ? v / 100 : v
}

function setCell(rows, r, c, v) {
  while (rows.length <= r) rows.push([])
  while (rows[r].length <= c) rows[r].push('')
  rows[r][c] = v
}

function parseBiff8(stream) {
  const sheets = []
  let cur = null
  const sst = []
  let i = 0

  while (i + 4 <= stream.length) {
    const type = stream.readUInt16LE(i)
    const len  = stream.readUInt16LE(i + 2)
    const d    = stream.slice(i + 4, i + 4 + len)
    i += 4 + len

    if (type === 0x0085 && d.length >= 8) {           // BOUNDSHEET
      const nLen = d[6], flag = d[7]
      const name = flag & 1
        ? d.slice(8, 8 + nLen * 2).toString('utf16le')
        : d.slice(8, 8 + nLen).toString('latin1')
      sheets.push({ name, rows: [] })
    } else if (type === 0x00FC && d.length >= 8) {    // SST
      const total = d.readUInt32LE(4)
      let pos = 8
      for (let s = 0; s < total && pos < d.length; s++) {
        const { str, len: l } = readBiff8Str(d, pos)
        sst.push(str); pos += l
      }
    } else if (type === 0x0809) {                      // BOF
      if (sheets.length > 0) cur = sheets[sheets.length - 1]
    } else if (type === 0x00FD && cur && d.length >= 10) { // LABELSST
      setCell(cur.rows, d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '')
    } else if (type === 0x0204 && cur && d.length >= 7) {  // LABEL
      const { str } = readBiff8Str(d, 6)
      setCell(cur.rows, d.readUInt16LE(0), d.readUInt16LE(2), str)
    } else if (type === 0x0203 && cur && d.length >= 14) { // NUMBER
      const v = d.readDoubleBE(6)
      setCell(cur.rows, d.readUInt16LE(0), d.readUInt16LE(2), isNaN(v) ? '' : String(v))
    } else if (type === 0x027E && cur && d.length >= 6) {  // RK
      setCell(cur.rows, d.readUInt16LE(0), d.readUInt16LE(2), String(decodeRk(d.readUInt32LE(4))))
    } else if (type === 0x00BE && cur && d.length >= 6) {  // MULRK
      const firstCol = d.readUInt16LE(2)
      const count    = (d.length - 6) / 6
      for (let c = 0; c < count; c++) {
        setCell(cur.rows, d.readUInt16LE(0), firstCol + c, String(decodeRk(d.readUInt32LE(4 + c * 6 + 2))))
      }
    }
  }

  return { sheets: sheets.filter(s => s.rows.length > 0) || sheets }
}
