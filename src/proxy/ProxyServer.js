/**
 * src/proxy/ProxyServer.js — 代理层：HTTP 反向代理服务器
 *
 * 职责：
 *   1. 监听本地端口，拦截所有发往 AI 的 HTTP 请求
 *   2. 对 POST JSON 请求体执行递归脱敏（兜底层）
 *   3. 将脱敏后的请求转发到真实上游
 *
 * 路由方案：
 *   index.js 把每个 provider 的 baseUrl 改写为：
 *     http://127.0.0.1:<port>/proxy/<base64url(原始URL)>
 *   ProxyServer 从路径中解码出真实上游 URL 并转发。
 *
 * 与 ToolPlugin 的关系：
 *   - ToolPlugin 在工具调用层精准脱敏文件内容（前置）
 *   - ProxyServer 在 HTTP 层对 messages 文本兜底脱敏（后置）
 *   - 两层互补，共享同一份 desensitize 引擎
 */

import http  from 'http'
import https from 'https'
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join }    from 'path'
import { desensitize } from '../core/desensitize.js'

// ── 配置 ──────────────────────────────────────────────────────────────────────

const DEFAULT_PORT           = 47291
const DEFAULT_BLOCK_ON_FAIL  = true

// ── 日志工厂 ──────────────────────────────────────────────────────────────────

/**
 * 创建一个简单的文件+stdout 日志器
 * @param {string} logFile
 * @returns {{ info, warn, error }}
 */
function createLogger(logFile) {
  const write = (level, msg) => {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`
    process.stdout.write(line)
    try { appendFileSync(logFile, line) } catch {}
  }
  return {
    info:  msg => write('INFO',  msg),
    warn:  msg => write('WARN',  msg),
    error: msg => write('ERROR', msg),
  }
}

// ── 路由解析 ──────────────────────────────────────────────────────────────────

/**
 * 从请求路径解码真实上游 URL
 *
 * 路径格式：/proxy/<base64url(originalUrl)>[/extra/path]
 *
 * 例：
 *   请求路径: /proxy/aHR0cHM6Ly9hcGkubWluaW1heC5jaGF0L3Yx/chat/completions
 *   解码得:   https://api.minimax.chat/v1
 *   转发到:   https://api.minimax.chat/v1/chat/completions
 *
 * @param {string} reqUrl
 * @returns {{ protocol, hostname, port, path } | null}
 */
function resolveTarget(reqUrl) {
  const proxyMatch = reqUrl.match(/^\/proxy\/([A-Za-z0-9_\-=]+)(\/.*)?$/)
  if (proxyMatch) {
    try {
      const decoded  = Buffer.from(proxyMatch[1], 'base64url').toString('utf8')
      const base     = new URL(decoded)
      const suffix   = proxyMatch[2] ?? ''
      const fullPath = base.pathname.replace(/\/$/, '') + suffix + (base.search ?? '')
      return {
        protocol: base.protocol,
        hostname: base.hostname,
        port:     base.port || (base.protocol === 'https:' ? '443' : '80'),
        path:     fullPath,
      }
    } catch { return null }
  }
  return null
}

// ── 脱敏核心 ──────────────────────────────────────────────────────────────────

/**
 * 递归遍历任意 JSON 对象，对所有字符串值执行脱敏
 * 兼容所有模型格式：OpenAI messages、Anthropic messages/system、
 * 旧版 prompt、HuggingFace inputs、MiniMax、Qwen 等
 *
 * @param {*} obj
 * @param {{ n: number, types: Record<string,number> }} counter
 * @returns {*}
 */
function desensitizeBody(obj, counter) {
  if (typeof obj === 'string') {
    // 不做 mightContainSensitiveData 前置过滤：
    // 单个字段值脱离上下文时快速检测容易漏判（如孤立的出生日期、座机号等）。
    // desensitize() 内部本身有快速路径，无命中时直接返回原值，性能影响可忽略。
    const { result, stats } = desensitize(obj)
    const total = Object.values(stats).reduce((a, b) => a + b, 0)
    if (total > 0) {
      counter.n += total
      counter.types = counter.types ?? {}
      for (const [k, v] of Object.entries(stats)) {
        counter.types[k] = (counter.types[k] ?? 0) + v
      }
      return result
    }
    return obj
  }
  if (Array.isArray(obj)) return obj.map(item => desensitizeBody(item, counter))
  if (obj !== null && typeof obj === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(obj)) out[key] = desensitizeBody(val, counter)
    return out
  }
  return obj
}

// ── HTTP 转发 ─────────────────────────────────────────────────────────────────

function forwardRequest(target, reqMethod, reqHeaders, body, res) {
  const isHttps   = target.protocol === 'https:'
  const transport = isHttps ? https : http
  const port      = parseInt(target.port) || (isHttps ? 443 : 80)

  const fwdHeaders = { ...reqHeaders }
  delete fwdHeaders['x-upstream-host']
  delete fwdHeaders['x-upstream-protocol']
  fwdHeaders['host'] = target.hostname

  const upstreamReq = transport.request(
    { hostname: target.hostname, port, path: target.path, method: reqMethod, headers: fwdHeaders },
    upstreamRes => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers)
      upstreamRes.pipe(res)
    }
  )

  upstreamReq.on('error', err => {
    if (!res.headersSent) {
      res.writeHead(502)
      res.end(JSON.stringify({ error: { message: `Data Guard Proxy: upstream error: ${err.message}` } }))
    }
  })

  upstreamReq.write(body)
  upstreamReq.end()
}

// ── ProxyServer 类 ────────────────────────────────────────────────────────────

export class ProxyServer {
  /**
   * @param {object} options
   * @param {number}  [options.port=47291]           - 监听端口
   * @param {boolean} [options.blockOnFailure=true]  - 脱敏失败时是否阻断请求
   * @param {string}  [options.logFile]              - 日志文件路径
   */
  constructor(options = {}) {
    this.port           = options.port           ?? DEFAULT_PORT
    this.blockOnFailure = options.blockOnFailure ?? DEFAULT_BLOCK_ON_FAIL
    this.logFile        = options.logFile        ?? null
    this._server        = null
    this._logger        = options.logFile ? createLogger(options.logFile) : null
  }

  /**
   * 启动代理服务器
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => this._handleRequest(req, res))

      this._server.on('error', err => {
        if (err.code === 'EADDRINUSE') {
          this._log('error', `端口 ${this.port} 已被占用`)
        } else {
          this._log('error', `服务器错误: ${err.message}`)
        }
        reject(err)
      })

      this._server.listen(this.port, '127.0.0.1', () => {
        this._log('info', `Data Guard proxy started, listening on http://127.0.0.1:${this.port}`)
        resolve()
      })
    })
  }

  /**
   * 停止代理服务器
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (!this._server) { resolve(); return }
      this._server.close(() => {
        this._log('info', '代理已停止')
        this._server = null
        resolve()
      })
    })
  }

  /**
   * 处理单个 HTTP 请求
   * @private
   */
  _handleRequest(req, res) {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks)

      // 解析目标上游
      const target = resolveTarget(req.url)
      if (!target) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: { message: 'Data Guard Proxy: no upstream route' } }))
        return
      }

      // 只对 POST + JSON 请求执行脱敏
      const contentType = req.headers['content-type'] ?? ''
      const isJsonPost  = req.method === 'POST' && contentType.includes('application/json')

      if (!isJsonPost) {
        forwardRequest(target, req.method, req.headers, rawBody, res)
        return
      }

      // 解析请求体
      let parsed
      try {
        parsed = JSON.parse(rawBody.toString('utf8'))
      } catch {
        this._log('warn', '请求体解析失败，直接透传')
        forwardRequest(target, req.method, req.headers, rawBody, res)
        return
      }

      // 递归脱敏整个请求体
      let desensitized, counter
      try {
        counter      = { n: 0 }
        desensitized = desensitizeBody(parsed, counter)
      } catch (err) {
        if (this.blockOnFailure) {
          this._log('error', `脱敏失败，已阻断请求: ${err.message}`)
          res.writeHead(500)
          res.end(JSON.stringify({ error: { message: 'Data Guard Proxy: desensitization failed, request blocked' } }))
          return
        } else {
          this._log('warn', `脱敏失败，透传原文（blockOnFailure=false）: ${err.message}`)
          forwardRequest(target, req.method, req.headers, rawBody, res)
          return
        }
      }

      if (counter.n > 0) {
        const typesSummary = Object.entries(counter.types ?? {}).map(([k, v]) => `${k}×${v}`).join(', ')
        this._log('info', `desensitized ${counter.n} item(s) [${typesSummary}]`)
        const newBody    = Buffer.from(JSON.stringify(desensitized), 'utf8')
        const newHeaders = { ...req.headers, 'content-length': String(newBody.length) }
        forwardRequest(target, req.method, newHeaders, newBody, res)
      } else {
        forwardRequest(target, req.method, req.headers, rawBody, res)
      }
    })

    req.on('error', err => {
      this._log('error', `请求读取失败: ${err.message}`)
      if (!res.headersSent) { res.writeHead(500); res.end() }
    })
  }

  /**
   * 内部日志（转发到外部 logger 或 stdout）
   * @private
   */
  _log(level, msg) {
    if (this._logger) {
      this._logger[level]?.(msg)
    } else {
      const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [proxy] ${msg}\n`
      process.stdout.write(line)
    }
  }
}
