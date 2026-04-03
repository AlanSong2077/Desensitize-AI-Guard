/**
 * test/proxy.test.js — 代理层测试
 *
 * 覆盖：
 *   - ProxyServer：启动/停止、请求脱敏、路由解析、错误处理
 *   - UrlRewriter：isProxyUrl / isLocalProxy / encodeProxyUrl / syncBaseUrls
 */

import { suite, test, assert } from './runner.js'
import http from 'http'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ProxyServer } from '../src/proxy/ProxyServer.js'
import {
  isProxyUrl, isLocalProxy, encodeProxyUrl, syncBaseUrls,
} from '../src/proxy/UrlRewriter.js'
import {
  OPENAI_REQUEST_SKIP,
  ANTHROPIC_REQUEST_SKIP_SYSTEM,
  REQUEST_SKIP_PROMPT,
  OPENAI_REQUEST_SKIP_PARTS,
  OPENAI_REQUEST_CUSTOM_SKIP,
} from './fixtures/index.js'

// ── UrlRewriter ───────────────────────────────────────────────────────────────

suite('proxy › UrlRewriter', () => {
  test('isProxyUrl：正确识别代理格式', () => {
    const encoded = Buffer.from('https://api.openai.com/v1').toString('base64')
    assert.ok(isProxyUrl(`http://127.0.0.1:47291/proxy/${encoded}`, 47291))
  })
  test('isProxyUrl：非代理格式返回 false', () => {
    assert.equal(isProxyUrl('https://api.openai.com/v1', 47291), false)
  })
  test('isProxyUrl：端口不匹配返回 false', () => {
    const encoded = Buffer.from('https://api.openai.com/v1').toString('base64')
    assert.equal(isProxyUrl(`http://127.0.0.1:47291/proxy/${encoded}`, 9999), false)
  })
  test('isLocalProxy：localhost 返回 true', () => {
    assert.ok(isLocalProxy('http://localhost:47291/proxy/xxx'))
  })
  test('isLocalProxy：127.0.0.1 返回 true', () => {
    assert.ok(isLocalProxy('http://127.0.0.1:47291/proxy/xxx'))
  })
  test('isLocalProxy：外部地址返回 false', () => {
    assert.equal(isLocalProxy('https://api.openai.com/v1'), false)
  })
  test('encodeProxyUrl：编码后可解码还原', () => {
    const original = 'https://api.minimax.chat/v1'
    const proxyUrl = encodeProxyUrl(original, 47291)
    assert.ok(proxyUrl.startsWith('http://127.0.0.1:47291/proxy/'))
    // 解码验证
    const encoded = proxyUrl.split('/proxy/')[1]
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    assert.equal(decoded, original)
  })
  test('encodeProxyUrl：不同 URL 生成不同代理地址', () => {
    const p1 = encodeProxyUrl('https://api.openai.com/v1', 47291)
    const p2 = encodeProxyUrl('https://api.anthropic.com/v1', 47291)
    assert.notEqual(p1, p2)
  })

  test('syncBaseUrls：改写 openclaw.json 中的 baseUrl', () => {
    const tmpFile = join(tmpdir(), `dg-test-openclaw-${process.pid}.json`)
    const config = {
      providers: {
        openai: { baseUrl: 'https://api.openai.com/v1' },
        claude: { baseUrl: 'https://api.anthropic.com/v1' },
      },
    }
    writeFileSync(tmpFile, JSON.stringify(config, null, 2), 'utf8')

    const { changed } = syncBaseUrls(tmpFile, 47291, null)
    assert.equal(changed, 2, '应改写 2 个 baseUrl')

    const updated = JSON.parse(readFileSync(tmpFile, 'utf8'))
    assert.ok(isProxyUrl(updated.providers.openai.baseUrl, 47291))
    assert.ok(isProxyUrl(updated.providers.claude.baseUrl, 47291))

    unlinkSync(tmpFile)
  })

  test('syncBaseUrls：已是代理格式的 baseUrl 跳过', () => {
    const tmpFile = join(tmpdir(), `dg-test-openclaw2-${process.pid}.json`)
    const encoded = Buffer.from('https://api.openai.com/v1').toString('base64')
    const config = {
      providers: {
        openai: { baseUrl: `http://127.0.0.1:47291/proxy/${encoded}` },
      },
    }
    writeFileSync(tmpFile, JSON.stringify(config, null, 2), 'utf8')

    const { changed, skipped } = syncBaseUrls(tmpFile, 47291, null)
    assert.equal(changed, 0)
    assert.equal(skipped, 1)

    unlinkSync(tmpFile)
  })

  test('syncBaseUrls：文件不存在时不报错', () => {
    const { changed } = syncBaseUrls('/nonexistent/openclaw.json', 47291, null)
    assert.equal(changed, 0)
  })
})

// ── ProxyServer 启动/停止 ─────────────────────────────────────────────────────

suite('proxy › ProxyServer 生命周期', () => {
  test('start() 成功监听端口，stop() 正常关闭', async () => {
    const port = 47399  // 使用非默认端口避免冲突
    const server = new ProxyServer({ port })
    await server.start()

    // 验证端口已监听（发一个请求）
    const res = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/health', method: 'GET' }, resolve)
      req.on('error', reject)
      req.end()
    })
    assert.ok(res.statusCode != null, '应收到响应')

    await server.stop()
  })

  test('stop() 未启动时不报错', async () => {
    const server = new ProxyServer({ port: 47400 })
    await server.stop()  // 不应抛出
  })
})

// ── ProxyServer 请求处理 ──────────────────────────────────────────────────────

suite('proxy › ProxyServer 请求脱敏', () => {
  // 启动一个 mock 上游服务器，记录收到的请求体
  let mockUpstream, mockPort, receivedBodies
  let proxyServer, proxyPort

  // 辅助：发送请求到代理
  function sendToProxy(body, upstreamUrl) {
    const encoded = Buffer.from(upstreamUrl).toString('base64')
    const path    = `/proxy/${encoded}/chat/completions`
    const bodyStr = JSON.stringify(body)

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port:     proxyPort,
        path,
        method:   'POST',
        headers:  { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyStr) },
      }, res => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      })
      req.on('error', reject)
      req.write(bodyStr)
      req.end()
    })
  }

  // 在第一个 test 前启动服务
  test('setup：启动 mock 上游 + 代理', async () => {
    receivedBodies = []
    mockPort = 47501

    mockUpstream = http.createServer((req, res) => {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try { receivedBodies.push(JSON.parse(Buffer.concat(chunks).toString())) } catch {}
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })
    await new Promise(r => mockUpstream.listen(mockPort, '127.0.0.1', r))

    proxyPort  = 47502
    proxyServer = new ProxyServer({ port: proxyPort, blockOnFailure: true })
    await proxyServer.start()
  })

  test('含敏感信息的 POST 请求被脱敏后转发', async () => {
    const upstreamUrl = `http://127.0.0.1:${mockPort}`
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: '手机：13812345678，邮箱：user@example.com' }],
    }
    await sendToProxy(body, upstreamUrl)

    assert.ok(receivedBodies.length > 0, '上游应收到请求')
    const received = receivedBodies[receivedBodies.length - 1]
    const content  = received.messages[0].content
    assert.notIncludes(content, '13812345678', '手机号应被脱敏')
    assert.notIncludes(content, 'user@example.com', '邮箱应被脱敏')
  })

  test('干净请求直接透传，内容不变', async () => {
    const upstreamUrl = `http://127.0.0.1:${mockPort}`
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: '帮我写一首诗' }],
    }
    const before = receivedBodies.length
    await sendToProxy(body, upstreamUrl)

    const received = receivedBodies[receivedBodies.length - 1]
    assert.equal(received.messages[0].content, '帮我写一首诗', '干净内容不应被修改')
  })

  test('非 JSON POST 请求直接透传', async () => {
    const encoded = Buffer.from(`http://127.0.0.1:${mockPort}`).toString('base64')
    const path    = `/proxy/${encoded}/upload`

    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port:     proxyPort,
        path,
        method:   'POST',
        headers:  { 'content-type': 'text/plain' },
      }, res => {
        res.resume()
        res.on('end', resolve)
      })
      req.on('error', reject)
      req.write('plain text body')
      req.end()
    })
    // 不报错即通过
  })

  test('无效路由返回 404', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port:     proxyPort,
        path:     '/unknown/path',
        method:   'GET',
      }, resolve)
      req.on('error', reject)
      req.end()
    })
    assert.equal(res.statusCode, 404)
  })

  test('teardown：关闭服务', async () => {
    await proxyServer.stop()
    await new Promise(r => mockUpstream.close(r))
  })
})

// ── ProxyServer skip-guard ────────────────────────────────────────────────────

suite('proxy › ProxyServer skip-guard', () => {
  let mockUpstream, mockPort, receivedBodies
  let proxyServer, proxyPort

  function sendToProxy(body, upstreamUrl, serverPort) {
    const encoded = Buffer.from(upstreamUrl).toString('base64')
    const path    = `/proxy/${encoded}/chat/completions`
    const bodyStr = JSON.stringify(body)

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port:     serverPort,
        path,
        method:   'POST',
        headers:  { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyStr) },
      }, res => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      })
      req.on('error', reject)
      req.write(bodyStr)
      req.end()
    })
  }

  test('setup：启动 mock 上游 + 代理（带 skip-guard）', async () => {
    receivedBodies = []
    mockPort = 47601

    mockUpstream = http.createServer((req, res) => {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try { receivedBodies.push(JSON.parse(Buffer.concat(chunks).toString())) } catch {}
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })
    await new Promise(r => mockUpstream.listen(mockPort, '127.0.0.1', r))

    proxyPort   = 47602
    proxyServer = new ProxyServer({ port: proxyPort, blockOnFailure: true, skipPrefix: '[skip-guard]' })
    await proxyServer.start()
  })

  test('user message 带 [skip-guard] 前缀：敏感信息原样透传', async () => {
    const upstreamUrl = `http://127.0.0.1:${mockPort}`
    await sendToProxy(OPENAI_REQUEST_SKIP, upstreamUrl, proxyPort)

    const received = receivedBodies[receivedBodies.length - 1]
    const content  = received.messages[1].content
    assert.includes(content, '13812345678', '手机号应原样保留（skip-guard 跳过脱敏）')
    assert.includes(content, '[skip-guard]', 'skip-guard 前缀应保留在消息中')
  })

  test('system 字段带 [skip-guard] 前缀：整个请求原样透传', async () => {
    const upstreamUrl = `http://127.0.0.1:${mockPort}`
    await sendToProxy(ANTHROPIC_REQUEST_SKIP_SYSTEM, upstreamUrl, proxyPort)

    const received = receivedBodies[receivedBodies.length - 1]
    // user message 中的敏感信息应原样保留
    const content = received.messages[0].content
    assert.includes(content, 'user@example.com', '邮箱应原样保留（system 带 skip-guard）')
  })

  test('旧版 prompt 字段带 [skip-guard] 前缀：原样透传', async () => {
    const upstreamUrl = `http://127.0.0.1:${mockPort}`
    await sendToProxy(REQUEST_SKIP_PROMPT, upstreamUrl, proxyPort)

    const received = receivedBodies[receivedBodies.length - 1]
    assert.includes(received.prompt, '13812345678', 'prompt 中手机号应原样保留')
  })

  test('content parts 数组中 text part 带 [skip-guard] 前缀：原样透传', async () => {
    const upstreamUrl = `http://127.0.0.1:${mockPort}`
    await sendToProxy(OPENAI_REQUEST_SKIP_PARTS, upstreamUrl, proxyPort)

    const received = receivedBodies[receivedBodies.length - 1]
    const textPart = received.messages[0].content.find(p => p.type === 'text')
    assert.includes(textPart.text, '13812345678', 'content parts 中手机号应原样保留')
  })

  test('不匹配的前缀不触发 skip：敏感信息正常脱敏', async () => {
    const upstreamUrl = `http://127.0.0.1:${mockPort}`
    await sendToProxy(OPENAI_REQUEST_CUSTOM_SKIP, upstreamUrl, proxyPort)

    const received = receivedBodies[receivedBodies.length - 1]
    const content  = received.messages[0].content
    assert.notIncludes(content, '13812345678', '[no-guard] 不是 skip 前缀，手机号应被脱敏')
  })

  test('自定义 skipPrefix 生效', async () => {
    // 启动一个使用自定义前缀的代理
    const customPort   = 47603
    const customServer = new ProxyServer({ port: customPort, skipPrefix: '[no-guard]' })
    await customServer.start()

    await sendToProxy(OPENAI_REQUEST_CUSTOM_SKIP, `http://127.0.0.1:${mockPort}`, customPort)
    const received = receivedBodies[receivedBodies.length - 1]
    const content  = received.messages[0].content
    assert.includes(content, '13812345678', '自定义前缀 [no-guard] 应触发 skip，手机号原样保留')

    await customServer.stop()
  })

  test('skipPrefix 为空字符串时不跳过脱敏', async () => {
    const noSkipPort   = 47604
    const noSkipServer = new ProxyServer({ port: noSkipPort, skipPrefix: '' })
    await noSkipServer.start()

    await sendToProxy(OPENAI_REQUEST_SKIP, `http://127.0.0.1:${mockPort}`, noSkipPort)
    const received = receivedBodies[receivedBodies.length - 1]
    const content  = received.messages[1].content
    assert.notIncludes(content, '13812345678', 'skipPrefix 为空时应正常脱敏')

    await noSkipServer.stop()
  })

  test('teardown：关闭 skip-guard 测试服务', async () => {
    await proxyServer.stop()
    await new Promise(r => mockUpstream.close(r))
  })
})
