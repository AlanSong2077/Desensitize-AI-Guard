/**
 * test/plugins.test.js — 插件层测试
 *
 * 覆盖：
 *   - Plugin 基类：接口约束、日志方法
 *   - ToolPlugin 基类：hook 注册、工具名过滤
 *   - FileDesensitizePlugin：工具调用拦截、路径替换、多路径支持
 */

import { suite, test, assert } from './runner.js'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Plugin }   from '../src/plugins/base/Plugin.js'
import { ToolPlugin } from '../src/plugins/base/ToolPlugin.js'
import { FileDesensitizePlugin } from '../src/plugins/tool/FileDesensitizePlugin.js'
import { CSV_WITH_SENSITIVE_COLS, CSV_CLEAN } from './fixtures/index.js'

const TEST_TEMP_DIR = join(tmpdir(), 'dg-plugins-test-' + process.pid)
mkdirSync(TEST_TEMP_DIR, { recursive: true })

// ── 测试用 mock API ───────────────────────────────────────────────────────────

function createMockApi() {
  const hooks = {}
  const logs  = []
  return {
    on(event, fn) { hooks[event] = fn },
    registerService(svc) { this._service = svc },
    logger: {
      info:  msg => logs.push({ level: 'info',  msg }),
      warn:  msg => logs.push({ level: 'warn',  msg }),
      error: msg => logs.push({ level: 'error', msg }),
    },
    _hooks: hooks,
    _logs:  logs,
    // 模拟触发 hook
    triggerToolCall(toolName, params) {
      const fn = hooks['before_tool_call']
      if (!fn) return undefined
      return fn({ toolName, params })
    },
  }
}

// ── Plugin 基类 ───────────────────────────────────────────────────────────────

suite('plugins › Plugin 基类', () => {
  test('未实现 id 时抛出', () => {
    class P extends Plugin { register() {} }
    assert.throws(() => new P().id, /must be implemented/)
  })
  test('未实现 name 时抛出', () => {
    class P extends Plugin {
      get id() { return 'x' }
      register() {}
    }
    assert.throws(() => new P().name, /must be implemented/)
  })
  test('未实现 register 时抛出', () => {
    class P extends Plugin {
      get id()   { return 'x' }
      get name() { return 'X' }
    }
    assert.throws(() => new P().register(), /must be implemented/)
  })
  test('description 默认为空字符串', () => {
    class P extends Plugin {
      get id()   { return 'x' }
      get name() { return 'X' }
      register() {}
    }
    assert.equal(new P().description, '')
  })
  test('version 默认为 1.0.0', () => {
    class P extends Plugin {
      get id()   { return 'x' }
      get name() { return 'X' }
      register() {}
    }
    assert.equal(new P().version, '1.0.0')
  })
  test('log() 调用 logger.info 并带前缀', () => {
    class P extends Plugin {
      get id()   { return 'my-plugin' }
      get name() { return 'X' }
      register() {}
    }
    const logs = []
    const logger = { info: msg => logs.push(msg) }
    new P().log(logger, '测试消息')
    assert.equal(logs.length, 1)
    assert.includes(logs[0], '[my-plugin]')
    assert.includes(logs[0], '测试消息')
  })
  test('log() logger 为 null 时不报错', () => {
    class P extends Plugin {
      get id()   { return 'x' }
      get name() { return 'X' }
      register() {}
    }
    new P().log(null, '消息')  // 不应抛出
  })
  test('extractConfig() 从 api.config 提取配置', () => {
    class P extends Plugin {
      get id()   { return 'my-plugin' }
      get name() { return 'X' }
      register() {}
    }
    const api = { config: { plugins: { entries: { 'my-plugin': { config: { port: 9999 } } } } } }
    const cfg = new P().extractConfig(api)
    assert.equal(cfg.port, 9999)
  })
  test('extractConfig() 配置不存在时返回空对象', () => {
    class P extends Plugin {
      get id()   { return 'x' }
      get name() { return 'X' }
      register() {}
    }
    const cfg = new P().extractConfig({})
    assert.deepEqual(cfg, {})
  })
})

// ── ToolPlugin 基类 ───────────────────────────────────────────────────────────

suite('plugins › ToolPlugin 基类', () => {
  test('未实现 supportedTools 时抛出', () => {
    class P extends ToolPlugin {
      get id()   { return 'x' }
      get name() { return 'X' }
      handleToolCall() {}
    }
    assert.throws(() => new P().supportedTools, /must be implemented/)
  })
  test('未实现 handleToolCall 时抛出', () => {
    class P extends ToolPlugin {
      get id()             { return 'x' }
      get name()           { return 'X' }
      get supportedTools() { return ['read'] }
    }
    assert.throws(() => new P().handleToolCall(), /must be implemented/)
  })
  test('register() 注册 before_tool_call hook', () => {
    class P extends ToolPlugin {
      get id()             { return 'x' }
      get name()           { return 'X' }
      get supportedTools() { return ['my_tool'] }
      handleToolCall()     { return { params: { modified: true } } }
    }
    const api = createMockApi()
    new P().register(api, {}, api.logger)
    assert.notNullish(api._hooks['before_tool_call'], 'hook 应被注册')
  })
  test('只处理 supportedTools 中的工具', () => {
    let called = false
    class P extends ToolPlugin {
      get id()             { return 'x' }
      get name()           { return 'X' }
      get supportedTools() { return ['my_tool'] }
      handleToolCall()     { called = true; return undefined }
    }
    const api = createMockApi()
    new P().register(api, {}, api.logger)

    // 触发不在列表中的工具
    api.triggerToolCall('other_tool', {})
    assert.equal(called, false, '不在列表中的工具不应触发 handleToolCall')

    // 触发在列表中的工具
    api.triggerToolCall('my_tool', {})
    assert.ok(called, '在列表中的工具应触发 handleToolCall')
  })
  test('handleToolCall 返回 undefined 时 hook 返回 undefined', () => {
    class P extends ToolPlugin {
      get id()             { return 'x' }
      get name()           { return 'X' }
      get supportedTools() { return ['my_tool'] }
      handleToolCall()     { return undefined }
    }
    const api = createMockApi()
    new P().register(api, {}, api.logger)
    const result = api.triggerToolCall('my_tool', {})
    assert.equal(result, undefined)
  })
  test('handleToolCall 返回修改后的 params', () => {
    class P extends ToolPlugin {
      get id()             { return 'x' }
      get name()           { return 'X' }
      get supportedTools() { return ['my_tool'] }
      handleToolCall(toolName, params) {
        return { params: { ...params, injected: true } }
      }
    }
    const api = createMockApi()
    new P().register(api, {}, api.logger)
    const result = api.triggerToolCall('my_tool', { original: 1 })
    assert.deepEqual(result, { params: { original: 1, injected: true } })
  })
})

// ── FileDesensitizePlugin ─────────────────────────────────────────────────────

suite('plugins › FileDesensitizePlugin', () => {
  // 准备测试文件
  const sensitiveFile = join(TEST_TEMP_DIR, 'plugin_sensitive.csv')
  const cleanFile     = join(TEST_TEMP_DIR, 'plugin_clean.csv')
  writeFileSync(sensitiveFile, CSV_WITH_SENSITIVE_COLS, 'utf8')
  writeFileSync(cleanFile,     CSV_CLEAN,               'utf8')

  test('id / name / supportedTools 正确', () => {
    const p = new FileDesensitizePlugin(TEST_TEMP_DIR)
    assert.equal(p.id, 'file-desensitize')
    assert.ok(p.supportedTools.includes('read'))
    assert.ok(p.supportedTools.includes('read_file'))
    assert.ok(p.supportedTools.includes('read_many_files'))
  })

  test('register() 注册 before_tool_call hook', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)
    assert.notNullish(api._hooks['before_tool_call'])
  })

  test('read_file：含敏感数据的 CSV 路径被替换', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    const result = api.triggerToolCall('read_file', { file_path: sensitiveFile })
    assert.notNullish(result, '应返回修改后的 params')
    assert.notEqual(result.params.file_path, sensitiveFile, '路径应被替换为临时文件')
  })

  test('read_file：干净 CSV 路径不被替换', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    const result = api.triggerToolCall('read_file', { file_path: cleanFile })
    assert.equal(result, undefined, '干净文件不应修改 params')
  })

  test('read：兼容 path 字段名', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    const result = api.triggerToolCall('read', { path: sensitiveFile })
    assert.notNullish(result)
    assert.notEqual(result.params.path, sensitiveFile)
  })

  test('read：兼容 filePath 字段名', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    const result = api.triggerToolCall('read', { filePath: sensitiveFile })
    assert.notNullish(result)
    assert.notEqual(result.params.filePath, sensitiveFile)
  })

  test('read_many_files：批量路径中的 CSV 被替换', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    const result = api.triggerToolCall('read_many_files', {
      paths: [sensitiveFile, cleanFile, '/tmp/readme.txt'],
    })
    assert.notNullish(result)
    // sensitiveFile 应被替换
    assert.notEqual(result.params.paths[0], sensitiveFile)
    // cleanFile 不含敏感数据，路径不变
    assert.equal(result.params.paths[1], cleanFile)
    // .txt 文件不处理，路径不变
    assert.equal(result.params.paths[2], '/tmp/readme.txt')
  })

  test('非文件读取工具不触发', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    const result = api.triggerToolCall('write_file', { file_path: sensitiveFile })
    assert.equal(result, undefined, 'write_file 不应被拦截')
  })

  test('不支持的文件格式不处理', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    const result = api.triggerToolCall('read_file', { file_path: '/tmp/doc.pdf' })
    assert.equal(result, undefined, '.pdf 不应被处理')
  })

  test('文件不存在时不报错，返回 undefined', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    const result = api.triggerToolCall('read_file', { file_path: '/nonexistent/file.csv' })
    assert.equal(result, undefined)
  })

  test('脱敏后 logger 记录了处理日志', () => {
    const api = createMockApi()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, {}, api.logger)

    api.triggerToolCall('read_file', { file_path: sensitiveFile })
    const infoLogs = api._logs.filter(l => l.level === 'info')
    assert.ok(infoLogs.length > 0, '应有 info 日志')
    const hasDesensitizeLog = infoLogs.some(l => l.msg.includes('已脱敏'))
    assert.ok(hasDesensitizeLog, '应有脱敏成功的日志')
  })
})

// ── FileDesensitizePlugin skip-guard ─────────────────────────────────────────

suite('plugins › FileDesensitizePlugin skip-guard', () => {
  const sensitiveFile = join(TEST_TEMP_DIR, 'skip_sensitive.csv')
  writeFileSync(sensitiveFile, CSV_WITH_SENSITIVE_COLS, 'utf8')

  // 扩展 mock API，支持传入 context
  function createMockApiWithContext() {
    const api = createMockApi()
    api.triggerToolCallWithContext = function(toolName, params, context) {
      const fn = api._hooks['before_tool_call']
      if (!fn) return undefined
      return fn({ toolName, params, context })
    }
    return api
  }

  test('params.explanation 带 skip-guard 前缀：跳过文件脱敏', () => {
    const api = createMockApiWithContext()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, { skipPrefix: '[skip-guard]' }, api.logger)

    const result = api.triggerToolCallWithContext(
      'read_file',
      { file_path: sensitiveFile, explanation: '[skip-guard] 需要读取原始数据' },
      undefined
    )
    assert.equal(result, undefined, 'explanation 带 skip-guard 时应跳过脱敏，返回 undefined')
  })

  test('context.explanation 带 skip-guard 前缀：跳过文件脱敏', () => {
    const api = createMockApiWithContext()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, { skipPrefix: '[skip-guard]' }, api.logger)

    const result = api.triggerToolCallWithContext(
      'read_file',
      { file_path: sensitiveFile },
      { explanation: '[skip-guard] 原始数据分析' }
    )
    assert.equal(result, undefined, 'context.explanation 带 skip-guard 时应跳过脱敏')
  })

  test('context.messages 最近 user 消息带 skip-guard 前缀：跳过文件脱敏', () => {
    const api = createMockApiWithContext()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, { skipPrefix: '[skip-guard]' }, api.logger)

    const result = api.triggerToolCallWithContext(
      'read_file',
      { file_path: sensitiveFile },
      {
        messages: [
          { role: 'system', content: '你是助手' },
          { role: 'user',   content: '[skip-guard] 请读取这个文件的原始内容' },
        ],
      }
    )
    assert.equal(result, undefined, 'context.messages 中 user 消息带 skip-guard 时应跳过脱敏')
  })

  test('context.messages content parts 带 skip-guard 前缀：跳过文件脱敏', () => {
    const api = createMockApiWithContext()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, { skipPrefix: '[skip-guard]' }, api.logger)

    const result = api.triggerToolCallWithContext(
      'read_file',
      { file_path: sensitiveFile },
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '[skip-guard] 读取原始文件' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
            ],
          },
        ],
      }
    )
    assert.equal(result, undefined, 'content parts 中 text 带 skip-guard 时应跳过脱敏')
  })

  test('无 skip-guard 前缀时正常脱敏', () => {
    const api = createMockApiWithContext()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, { skipPrefix: '[skip-guard]' }, api.logger)

    const result = api.triggerToolCallWithContext(
      'read_file',
      { file_path: sensitiveFile },
      { messages: [{ role: 'user', content: '请读取这个文件' }] }
    )
    assert.notNullish(result, '无 skip-guard 时应正常脱敏，返回修改后的 params')
    assert.notEqual(result.params.file_path, sensitiveFile, '路径应被替换为临时文件')
  })

  test('自定义 skipPrefix 生效', () => {
    const api = createMockApiWithContext()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, { skipPrefix: '[raw]' }, api.logger)

    const result = api.triggerToolCallWithContext(
      'read_file',
      { file_path: sensitiveFile, explanation: '[raw] 读取原始数据' },
      undefined
    )
    assert.equal(result, undefined, '自定义前缀 [raw] 应触发 skip')
  })

  test('skipPrefix 为空时不跳过脱敏', () => {
    const api = createMockApiWithContext()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, { skipPrefix: '' }, api.logger)

    const result = api.triggerToolCallWithContext(
      'read_file',
      { file_path: sensitiveFile, explanation: '[skip-guard] 读取原始数据' },
      undefined
    )
    // skipPrefix 为空时不跳过，应正常脱敏
    assert.notNullish(result, 'skipPrefix 为空时不应跳过脱敏')
  })

  test('skip-guard 日志记录正确', () => {
    const api = createMockApiWithContext()
    const p   = new FileDesensitizePlugin(TEST_TEMP_DIR)
    p.register(api, { skipPrefix: '[skip-guard]' }, api.logger)

    api.triggerToolCallWithContext(
      'read_file',
      { file_path: sensitiveFile, explanation: '[skip-guard] 读取原始数据' },
      undefined
    )
    const infoLogs = api._logs.filter(l => l.level === 'info')
    const hasSkipLog = infoLogs.some(l => l.msg.includes('skip-guard'))
    assert.ok(hasSkipLog, '应有 skip-guard 跳过的日志')
  })
})
