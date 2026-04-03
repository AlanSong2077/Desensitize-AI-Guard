/**
 * src/plugins/tool/formats/FileFormat.js — 文件格式处理器抽象基类
 *
 * 每种文件格式（CSV、XLSX、XLS 等）都应实现此接口。
 * 框架通过 FileFormatRegistry 统一管理所有格式处理器。
 *
 * 开发者指南：
 *   1. 继承 FileFormat
 *   2. 实现 extensions（声明支持的扩展名）
 *   3. 实现 parse(buffer)（将文件内容解析为统一的 ParsedFile 结构）
 *   4. 实现 serialize(parsedFile)（将 ParsedFile 序列化回字节）
 *   5. 在 FileFormatRegistry 中注册
 *
 * ParsedFile 结构：
 *   {
 *     sheets: [
 *       { name: string, rows: string[][] }
 *     ]
 *   }
 *
 * 使用示例：
 *   class MyFormat extends FileFormat {
 *     get extensions() { return ['.myext'] }
 *
 *     parse(buffer) {
 *       // 解析 buffer，返回 ParsedFile
 *       return { sheets: [{ name: 'Sheet1', rows: [...] }] }
 *     }
 *
 *     serialize(parsedFile) {
 *       // 将 ParsedFile 序列化为 Buffer
 *       return Buffer.from(...)
 *     }
 *   }
 */

export class FileFormat {
  /**
   * 此格式处理器支持的文件扩展名列表（小写，含点号）
   * 子类必须实现。
   * @returns {string[]}  例如 ['.csv'] 或 ['.xlsx', '.xlsm']
   */
  get extensions() {
    throw new Error(`FileFormat.extensions must be implemented by ${this.constructor.name}`)
  }

  /**
   * 此格式 serialize() 输出的文件扩展名（决定临时文件的扩展名）
   * 子类应覆盖此属性以匹配实际输出格式。
   * 默认为 .txt（纯文本）。
   * @returns {string}
   */
  get outputExtension() { return '.txt' }

  /**
   * 将文件内容解析为统一的 ParsedFile 结构
   *
   * @param {Buffer} buffer  - 文件原始字节
   * @returns {ParsedFile}   - { sheets: [{ name, rows }] }
   */
  parse(buffer) {
    throw new Error(`FileFormat.parse() must be implemented by ${this.constructor.name}`)
  }

  /**
   * 将 ParsedFile 结构序列化为字节（用于写入临时文件）
   *
   * 默认实现：序列化为 CSV 文本（UTF-8）。
   * 子类可以覆盖此方法以输出原始格式（如 .xlsx）。
   *
   * @param {ParsedFile} parsedFile
   * @returns {Buffer}
   */
  serialize(parsedFile) {
    const text = parsedFile.sheets.map((sheet, i) => {
      const header = parsedFile.sheets.length > 1 ? `=== ${sheet.name} ===\n` : ''
      const csv = sheet.rows.map(row =>
        row.map(cell => {
          const s = String(cell ?? '')
          return (s.includes(',') || s.includes('"') || s.includes('\n'))
            ? '"' + s.replace(/"/g, '""') + '"'
            : s
        }).join(',')
      ).join('\n')
      return header + csv
    }).join('\n\n')
    return Buffer.from(text, 'utf8')
  }

  /**
   * 检查此处理器是否支持给定扩展名
   * @param {string} ext  - 小写扩展名（含点号）
   * @returns {boolean}
   */
  supports(ext) {
    return this.extensions.includes(ext.toLowerCase())
  }
}

// ── 文件格式注册表 ────────────────────────────────────────────────────────────

/**
 * FileFormatRegistry — 管理所有已注册的文件格式处理器
 *
 * 开发者可以通过 register() 添加新格式，无需修改核心代码。
 *
 * 使用示例：
 *   import { registry } from './FileFormat.js'
 *   import { MyFormat } from './MyFormat.js'
 *   registry.register(new MyFormat())
 */
export class FileFormatRegistry {
  constructor() {
    /** @type {FileFormat[]} */
    this._formats = []
  }

  /**
   * 注册一个文件格式处理器
   * @param {FileFormat} format
   */
  register(format) {
    if (!(format instanceof FileFormat)) {
      throw new TypeError('format must be an instance of FileFormat')
    }
    this._formats.push(format)
    return this  // 支持链式调用
  }

  /**
   * 根据扩展名查找对应的格式处理器
   * @param {string} ext  - 小写扩展名（含点号）
   * @returns {FileFormat | null}
   */
  find(ext) {
    return this._formats.find(f => f.supports(ext)) ?? null
  }

  /**
   * 获取所有已注册格式支持的扩展名集合
   * @returns {Set<string>}
   */
  get supportedExtensions() {
    const set = new Set()
    for (const f of this._formats) {
      for (const ext of f.extensions) set.add(ext)
    }
    return set
  }

  /**
   * 列出所有已注册的格式处理器
   * @returns {FileFormat[]}
   */
  list() {
    return [...this._formats]
  }
}

/** 全局默认注册表（单例） */
export const registry = new FileFormatRegistry()
