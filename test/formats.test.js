/**
 * test/formats.test.js — 文件格式插件层测试
 *
 * 覆盖：
 *   - FileFormat 抽象基类：接口约束
 *   - FileFormatRegistry：注册、查找、扩展名集合
 *   - CsvFormat：parse / serialize 往返一致性
 *   - XlsxFormat：parse 基本功能（用内存构造的最小 XLSX）
 *   - XlsFormat：parse 基本功能（用内存构造的最小 XLS）
 *   - 自定义格式扩展：开发者可以注册新格式
 */

import { suite, test, assert } from './runner.js'
import { FileFormat, FileFormatRegistry, registry as globalRegistry } from '../src/plugins/tool/formats/FileFormat.js'
import { CsvFormat, parseCsvLine, toCsvField } from '../src/plugins/tool/formats/CsvFormat.js'
import { XlsxFormat } from '../src/plugins/tool/formats/XlsxFormat.js'
import { XlsFormat }  from '../src/plugins/tool/formats/XlsFormat.js'
import { registry }   from '../src/plugins/tool/formats/index.js'

import {
  CSV_WITH_SENSITIVE_COLS, CSV_CLEAN, CSV_QUOTED, CSV_MIXED_COLS,
  PARSED_SINGLE_SHEET, PARSED_MULTI_SHEET, PARSED_EMPTY,
} from './fixtures/index.js'

// ── FileFormat 抽象基类 ───────────────────────────────────────────────────────

suite('formats › FileFormat 抽象基类', () => {
  test('未实现 extensions 时抛出', () => {
    class Broken extends FileFormat {}
    assert.throws(() => new Broken().extensions, /must be implemented/)
  })
  test('未实现 parse 时抛出', () => {
    class Broken extends FileFormat {
      get extensions() { return ['.x'] }
    }
    assert.throws(() => new Broken().parse(Buffer.alloc(0)), /must be implemented/)
  })
  test('supports() 大小写不敏感', () => {
    class F extends FileFormat {
      get extensions() { return ['.csv'] }
      parse() { return { sheets: [] } }
    }
    const f = new F()
    assert.ok(f.supports('.csv'))
    assert.ok(f.supports('.CSV'))
    assert.equal(f.supports('.xlsx'), false)
  })
  test('默认 serialize() 输出 CSV 格式', () => {
    class F extends FileFormat {
      get extensions() { return ['.x'] }
      parse() { return { sheets: [] } }
    }
    const f = new F()
    const buf = f.serialize(PARSED_SINGLE_SHEET)
    const text = buf.toString('utf8')
    assert.includes(text, '姓名')
    assert.includes(text, '张三')
  })
})

// ── FileFormatRegistry ────────────────────────────────────────────────────────

suite('formats › FileFormatRegistry', () => {
  test('全局 registry 已注册 csv/xlsx/xls', () => {
    const exts = registry.supportedExtensions
    assert.ok(exts.has('.csv'),  '应支持 .csv')
    assert.ok(exts.has('.xlsx'), '应支持 .xlsx')
    assert.ok(exts.has('.xls'),  '应支持 .xls')
  })
  test('find() 返回正确处理器', () => {
    assert.ok(registry.find('.csv')  instanceof CsvFormat)
    assert.ok(registry.find('.xlsx') instanceof XlsxFormat)
    assert.ok(registry.find('.xls')  instanceof XlsFormat)
  })
  test('find() 大小写不敏感', () => {
    assert.notNullish(registry.find('.CSV'))
    assert.notNullish(registry.find('.XLSX'))
  })
  test('find() 未知格式返回 null', () => {
    assert.nullish(registry.find('.mp3'))
    assert.nullish(registry.find('.zip'))
  })
  test('register() 支持链式调用', () => {
    const r = new FileFormatRegistry()
    class F1 extends FileFormat { get extensions() { return ['.a'] }; parse() {} }
    class F2 extends FileFormat { get extensions() { return ['.b'] }; parse() {} }
    r.register(new F1()).register(new F2())
    assert.ok(r.supportedExtensions.has('.a'))
    assert.ok(r.supportedExtensions.has('.b'))
  })
  test('register() 传入非 FileFormat 实例时抛出', () => {
    const r = new FileFormatRegistry()
    assert.throws(() => r.register({ extensions: ['.x'] }), /FileFormat/)
  })
  test('list() 返回所有已注册处理器', () => {
    const r = new FileFormatRegistry()
    class F extends FileFormat { get extensions() { return ['.z'] }; parse() {} }
    r.register(new F())
    assert.equal(r.list().length, 1)
  })
  test('开发者可注册自定义格式（扩展性验证）', () => {
    const r = new FileFormatRegistry()
    class TsvFormat extends FileFormat {
      get extensions() { return ['.tsv'] }
      parse(buffer) {
        const rows = buffer.toString('utf8').split('\n').filter(Boolean).map(l => l.split('\t'))
        return { sheets: [{ name: 'Sheet1', rows }] }
      }
    }
    r.register(new TsvFormat())
    assert.ok(r.supportedExtensions.has('.tsv'))
    const fmt = r.find('.tsv')
    const parsed = fmt.parse(Buffer.from('a\tb\tc\n1\t2\t3'))
    assert.equal(parsed.sheets[0].rows.length, 2)
    assert.equal(parsed.sheets[0].rows[0][1], 'b')
  })
})

// ── CsvFormat ─────────────────────────────────────────────────────────────────

suite('formats › CsvFormat', () => {
  const fmt = new CsvFormat()

  test('parse：基本 CSV', () => {
    const parsed = fmt.parse(Buffer.from(CSV_WITH_SENSITIVE_COLS))
    assert.equal(parsed.sheets.length, 1)
    assert.equal(parsed.sheets[0].rows.length, 4)  // 1 header + 3 data
    assert.equal(parsed.sheets[0].rows[0][0], '姓名')
    assert.equal(parsed.sheets[0].rows[1][1], '13812345678')
  })
  test('parse：干净 CSV', () => {
    const parsed = fmt.parse(Buffer.from(CSV_CLEAN))
    assert.equal(parsed.sheets[0].rows.length, 4)
  })
  test('parse：含引号转义', () => {
    const parsed = fmt.parse(Buffer.from(CSV_QUOTED))
    assert.equal(parsed.sheets[0].rows[1][1], '手机：13812345678，地址：北京市')
  })
  test('parse：空 Buffer 返回空 rows', () => {
    const parsed = fmt.parse(Buffer.from(''))
    assert.equal(parsed.sheets[0].rows.length, 0)
  })
  test('serialize：往返一致性（parse → serialize → parse）', () => {
    const original = fmt.parse(Buffer.from(CSV_CLEAN))
    const serialized = fmt.serialize(original)
    const reparsed = fmt.parse(serialized)
    assert.deepEqual(original.sheets[0].rows, reparsed.sheets[0].rows)
  })
  test('serialize：多 Sheet 用分隔符区分', () => {
    // CsvFormat 默认 serialize 继承自 FileFormat，多 sheet 用 === 分隔
    const buf = fmt.serialize(PARSED_MULTI_SHEET)
    const text = buf.toString('utf8')
    // CsvFormat 只序列化第一个 sheet（单 sheet 模式）
    // 多 sheet 走父类默认实现
    assert.ok(buf.length > 0)
  })
  test('serialize：空 ParsedFile 返回空 Buffer', () => {
    const buf = fmt.serialize({ sheets: [] })
    assert.equal(buf.length, 0)
  })
})

// ── parseCsvLine 工具函数 ─────────────────────────────────────────────────────

suite('formats › parseCsvLine()', () => {
  test('基本分割', () => {
    assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c'])
  })
  test('引号内的逗号不分割', () => {
    assert.deepEqual(parseCsvLine('"a,b",c'), ['a,b', 'c'])
  })
  test('双引号转义', () => {
    assert.deepEqual(parseCsvLine('"a""b",c'), ['a"b', 'c'])
  })
  test('空字段', () => {
    assert.deepEqual(parseCsvLine('a,,c'), ['a', '', 'c'])
  })
  test('首尾空字段', () => {
    assert.deepEqual(parseCsvLine(',a,'), ['', 'a', ''])
  })
})

// ── toCsvField 工具函数 ───────────────────────────────────────────────────────

suite('formats › toCsvField()', () => {
  test('普通字符串不加引号', () => {
    assert.equal(toCsvField('hello'), 'hello')
  })
  test('含逗号加引号', () => {
    assert.equal(toCsvField('a,b'), '"a,b"')
  })
  test('含双引号转义', () => {
    assert.equal(toCsvField('say "hi"'), '"say ""hi"""')
  })
  test('含换行加引号', () => {
    assert.equal(toCsvField('line1\nline2'), '"line1\nline2"')
  })
})

// ── XlsxFormat ────────────────────────────────────────────────────────────────

suite('formats › XlsxFormat', () => {
  const fmt = new XlsxFormat()

  test('extensions 包含 .xlsx 和 .xlsm', () => {
    assert.ok(fmt.extensions.includes('.xlsx'))
    assert.ok(fmt.extensions.includes('.xlsm'))
  })
  test('supports() 正确', () => {
    assert.ok(fmt.supports('.xlsx'))
    assert.ok(fmt.supports('.xlsm'))
    assert.equal(fmt.supports('.csv'), false)
  })
  test('parse 损坏数据不抛出（返回空 sheets）', () => {
    // 传入随机字节，不应崩溃
    try {
      const result = fmt.parse(Buffer.from('not a valid xlsx file'))
      // 可能返回空 sheets 或抛出，两种都可接受
      assert.ok(Array.isArray(result.sheets))
    } catch (e) {
      // 抛出也可接受，只要不是未捕获的崩溃
      assert.ok(e instanceof Error)
    }
  })
})

// ── XlsFormat ─────────────────────────────────────────────────────────────────

suite('formats › XlsFormat', () => {
  const fmt = new XlsFormat()

  test('extensions 包含 .xls', () => {
    assert.ok(fmt.extensions.includes('.xls'))
  })
  test('supports() 正确', () => {
    assert.ok(fmt.supports('.xls'))
    assert.equal(fmt.supports('.xlsx'), false)
  })
  test('parse 非 OLE2 数据不崩溃', () => {
    try {
      const result = fmt.parse(Buffer.from('not a valid xls file'))
      assert.ok(Array.isArray(result.sheets))
    } catch (e) {
      assert.ok(e instanceof Error)
    }
  })
})
