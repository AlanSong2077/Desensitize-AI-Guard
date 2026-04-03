/**
 * test/input.test.js — 输入层测试
 *
 * 覆盖：
 *   - desensitizeSheets()：列名精准脱敏 + 兜底正则脱敏
 *   - readAndDesensitize()：文件读取 → 脱敏 → 写临时文件全流程
 *   - makeTempPath()：路径生成唯一性
 *   - ensureTempDir()：目录创建
 */

import { suite, test, assert } from './runner.js'
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, rmdirSync } from 'fs'
import { join, extname } from 'path'
import { tmpdir, homedir } from 'os'
import {
  desensitizeSheets,
  readAndDesensitize,
  makeTempPath,
  ensureTempDir,
} from '../src/input/FileReader.js'
import {
  PARSED_SINGLE_SHEET, PARSED_EMPTY, PARSED_MULTI_SHEET,
  CSV_WITH_SENSITIVE_COLS, CSV_CLEAN, CSV_MIXED_COLS,
} from './fixtures/index.js'

// 测试用临时目录
const TEST_TEMP_DIR = join(tmpdir(), 'data-guard-test-' + process.pid)

// ── desensitizeSheets() ───────────────────────────────────────────────────────

suite('input › desensitizeSheets()', () => {
  test('含敏感列名的 ParsedFile 被脱敏', () => {
    const { sheets, stats } = desensitizeSheets(PARSED_SINGLE_SHEET)
    const rows = sheets.sheets[0].rows
    // 表头保持不变
    assert.deepEqual(rows[0], ['姓名', '手机', '邮箱'])
    // 数据行被脱敏
    assert.notEqual(rows[1][1], '13812345678', '手机号应被脱敏')
    assert.notEqual(rows[1][2], 'zhang@example.com', '邮箱应被脱敏')
    assert.ok(stats.total > 0, '应有脱敏统计')
  })
  test('脱敏后表头行不变', () => {
    const { sheets } = desensitizeSheets(PARSED_SINGLE_SHEET)
    assert.deepEqual(sheets.sheets[0].rows[0], PARSED_SINGLE_SHEET.sheets[0].rows[0])
  })
  test('空 ParsedFile 不报错', () => {
    const { sheets, stats } = desensitizeSheets(PARSED_EMPTY)
    assert.equal(stats.total, 0)
  })
  test('多 Sheet 全部被处理', () => {
    const { sheets, stats } = desensitizeSheets(PARSED_MULTI_SHEET)
    assert.equal(sheets.sheets.length, 2)
    // 第一个 sheet 含手机号，应被脱敏
    assert.notEqual(sheets.sheets[0].rows[1][1], '13812345678')
  })
  test('无敏感数据时 stats.total 为 0', () => {
    const cleanParsed = {
      sheets: [{
        name: 'Sheet1',
        rows: [
          ['产品', '数量', '备注'],
          ['苹果', '100', '新鲜'],
        ],
      }],
    }
    const { stats } = desensitizeSheets(cleanParsed)
    assert.equal(stats.total, 0)
  })
  test('同一列内多行数据都被脱敏', () => {
    const { sheets } = desensitizeSheets(PARSED_SINGLE_SHEET)
    const rows = sheets.sheets[0].rows
    // 两行数据都应被脱敏
    assert.notEqual(rows[1][1], '13812345678')
    assert.notEqual(rows[2][1], '13987654321')
  })
  test('脱敏后数据行数不变', () => {
    const { sheets } = desensitizeSheets(PARSED_SINGLE_SHEET)
    assert.equal(
      sheets.sheets[0].rows.length,
      PARSED_SINGLE_SHEET.sheets[0].rows.length
    )
  })
  test('脱敏后列数不变', () => {
    const { sheets } = desensitizeSheets(PARSED_SINGLE_SHEET)
    const origCols = PARSED_SINGLE_SHEET.sheets[0].rows[1].length
    const newCols  = sheets.sheets[0].rows[1].length
    assert.equal(newCols, origCols)
  })
})

// ── makeTempPath() ────────────────────────────────────────────────────────────

suite('input › makeTempPath()', () => {
  test('生成路径以 dg_ 开头', () => {
    const p = makeTempPath('/some/file.csv', TEST_TEMP_DIR)
    assert.includes(p, 'dg_')
  })
  test('不传 format 时扩展名与原始文件一致', () => {
    assert.equal(extname(makeTempPath('/some/file.csv',  TEST_TEMP_DIR)), '.csv')
    assert.equal(extname(makeTempPath('/some/file.xlsx', TEST_TEMP_DIR)), '.xlsx')
    assert.equal(extname(makeTempPath('/some/file.pdf',  TEST_TEMP_DIR)), '.pdf')
  })
  test('传 format 时扩展名由 outputExtension 决定', () => {
    assert.equal(extname(makeTempPath('/some/file.xlsx', TEST_TEMP_DIR, { outputExtension: '.csv'  })), '.csv')
    assert.equal(extname(makeTempPath('/some/file.xls',  TEST_TEMP_DIR, { outputExtension: '.csv'  })), '.csv')
    assert.equal(extname(makeTempPath('/some/file.docx', TEST_TEMP_DIR, { outputExtension: '.txt'  })), '.txt')
    assert.equal(extname(makeTempPath('/some/file.pptx', TEST_TEMP_DIR, { outputExtension: '.pptx' })), '.pptx')
  })
  test('两次调用生成不同路径（含时间戳）', () => {
    const p1 = makeTempPath('/some/file.csv', TEST_TEMP_DIR)
    const p2 = makeTempPath('/some/file.csv', TEST_TEMP_DIR)
    assert.notEqual(p1, p2, '每次调用应生成唯一路径')
  })
  test('路径在指定 tempDir 下', () => {
    const p = makeTempPath('/some/file.csv', TEST_TEMP_DIR)
    assert.ok(p.startsWith(TEST_TEMP_DIR))
  })
})

// ── ensureTempDir() ───────────────────────────────────────────────────────────

suite('input › ensureTempDir()', () => {
  const testDir = join(tmpdir(), 'dg-ensure-test-' + process.pid)

  test('目录不存在时创建', () => {
    ensureTempDir(testDir)
    assert.ok(existsSync(testDir), '目录应被创建')
    try { rmdirSync(testDir) } catch {}
  })
  test('目录已存在时不报错', () => {
    mkdirSync(testDir, { recursive: true })
    ensureTempDir(testDir)  // 不应抛出
    assert.ok(existsSync(testDir))
    try { rmdirSync(testDir) } catch {}
  })
})

// ── readAndDesensitize() 全流程 ───────────────────────────────────────────────

suite('input › readAndDesensitize() 全流程', () => {
  // 在测试前创建临时目录
  mkdirSync(TEST_TEMP_DIR, { recursive: true })

  // 创建测试用 CSV 文件
  const sensitiveFile = join(TEST_TEMP_DIR, 'sensitive.csv')
  const cleanFile     = join(TEST_TEMP_DIR, 'clean.csv')
  const xlsxFile      = join(TEST_TEMP_DIR, 'test.xlsx')  // 不存在，测试不存在情况
  const unknownFile   = join(TEST_TEMP_DIR, 'test.pdf')

  writeFileSync(sensitiveFile, CSV_WITH_SENSITIVE_COLS, 'utf8')
  writeFileSync(cleanFile,     CSV_CLEAN,               'utf8')

  test('含敏感数据的 CSV：changed=true，生成临时文件', () => {
    const result = readAndDesensitize(sensitiveFile, TEST_TEMP_DIR)
    assert.equal(result.changed, true)
    assert.notEqual(result.outputPath, sensitiveFile, '输出路径应不同于原始路径')
    assert.ok(existsSync(result.outputPath), '临时文件应存在')
    assert.ok(result.stats.total > 0, '应有脱敏统计')
  })
  test('临时文件内容不含原始敏感数据', () => {
    const result = readAndDesensitize(sensitiveFile, TEST_TEMP_DIR)
    const content = readFileSync(result.outputPath, 'utf8')
    assert.notIncludes(content, '13812345678')
    assert.notIncludes(content, 'zhang@example.com')
    assert.notIncludes(content, '110101199001011234')
  })
  test('临时文件保留表头', () => {
    const result = readAndDesensitize(sensitiveFile, TEST_TEMP_DIR)
    const content = readFileSync(result.outputPath, 'utf8')
    assert.includes(content, '姓名')
    assert.includes(content, '手机')
    assert.includes(content, '邮箱')
  })
  test('干净 CSV：changed=false，不生成临时文件', () => {
    const result = readAndDesensitize(cleanFile, TEST_TEMP_DIR)
    assert.equal(result.changed, false)
    assert.equal(result.outputPath, cleanFile, '输出路径应等于原始路径')
    assert.equal(result.stats.total, 0)
  })
  test('不支持的格式：changed=false，原样返回', () => {
    writeFileSync(unknownFile, 'some content', 'utf8')
    const result = readAndDesensitize(unknownFile, TEST_TEMP_DIR)
    assert.equal(result.changed, false)
    assert.equal(result.outputPath, unknownFile)
  })
  test('文件不存在：返回 error 字段', () => {
    const result = readAndDesensitize('/nonexistent/path/file.csv', TEST_TEMP_DIR)
    assert.equal(result.changed, false)
    assert.notNullish(result.error, '应有 error 字段')
  })
  test('stats.byType 包含脱敏类型明细', () => {
    const result = readAndDesensitize(sensitiveFile, TEST_TEMP_DIR)
    assert.ok(Object.keys(result.stats.byType).length > 0, '应有类型明细')
  })
})
