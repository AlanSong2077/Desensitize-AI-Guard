/**
 * src/plugins/ProxyPlugin.js — HTTP 代理插件
 *
 * 将 ProxyServer 包装为 OpenClaw Plugin，负责：
 *   1. 在 Gateway 启动时改写 openclaw.json 中的 baseUrl
 *   2. 启动本地 HTTP 代理子进程（proxy.js）
 *   3. 在 Gateway 停止时关闭代理
 *
 * 注意：代理以子进程方式运行（spawn proxy.js），而非直接在主进程中启动。
 * 这样可以避免代理崩溃影响主进程，也便于独立重启。
 */

import { spawn, execFileSync }            from 'child_process'
import { existsSync, readFileSync,
         unlinkSync }                     from 'fs'
import { join }                           from 'path'
import { homedir }                        from 'os'
import { Plugin }                         from './base/Plugin.js'
import { syncBaseUrls, restoreBaseUrls }  from '../proxy/UrlRewriter.js'

// ── PID 文件路径（与 proxy-process.js 保持一致）────────────────────────────────
function getPidFile(openclawDir) {
  const base = openclawDir
    ?? (process.platform === 'win32'
        ? join(process.env.APPDATA || homedir(), '.openclaw')
        : join(homedir(), '.openclaw'))
  return join(base, 'data-guard', 'proxy.pid')
}

/**
 * 读取 PID 文件并 kill 旧进程（如果还活着）
 * @param {string} pidFile
 * @param {object} logger
 */
function killStalePid(pidFile, logger) {
  if (!existsSync(pidFile)) return
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
    if (!pid || isNaN(pid)) return
    try {
      process.kill(pid, 0)          // 探测进程是否存在
      process.kill(pid, 'SIGTERM')  // 存在则 kill
      logger?.info(`[data-guard-proxy] 已终止旧代理进程 PID=${pid}`)
      // 用 Atomics.wait 做非忙等的短暂阻塞，给子进程时间释放端口（通常 <50ms）
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
    } catch (e) {
      if (e.code !== 'ESRCH') logger?.warn(`[data-guard-proxy] kill 旧进程失败: ${e.message}`)
      // ESRCH = 进程不存在，正常情况
    }
    try { unlinkSync(pidFile) } catch {}
  } catch (e) {
    logger?.warn(`[data-guard-proxy] 读取 PID 文件失败: ${e.message}`)
  }
}

/**
 * 兜底：通过 lsof 按端口查找并 kill 残留进程
 * 处理 PID 文件缺失或记录失效时端口仍被占用的情况
 * @param {number} port
 * @param {object} logger
 */
function killPortProcess(port, logger) {
  try {
    // lsof -ti :PORT 输出占用该端口的所有 PID，每行一个
    const out = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8', timeout: 3000 }).trim()
    if (!out) return
    for (const pidStr of out.split('\n')) {
      const pid = parseInt(pidStr.trim(), 10)
      if (!pid || isNaN(pid) || pid === process.pid) continue
      try {
        process.kill(pid, 'SIGTERM')
        logger?.info(`[data-guard-proxy] 按端口清理残留进程 PID=${pid} port=${port}`)
      } catch (e) {
        if (e.code !== 'ESRCH') logger?.warn(`[data-guard-proxy] 按端口 kill 失败 PID=${pid}: ${e.message}`)
      }
    }
    // 等待端口释放
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
  } catch (e) {
    // lsof 不存在或端口未被占用，忽略
  }
}

export class ProxyPlugin extends Plugin {
  /**
   * @param {object} options
   * @param {string} options.proxyScriptPath     - proxy.js 子进程脚本路径
   * @param {string} options.openclawJsonPath    - openclaw.json 路径
   * @param {string} options.sidecarPath         - 原始 URL 备份文件路径
   */
  constructor(options = {}) {
    super()
    this.proxyScriptPath  = options.proxyScriptPath
    this.openclawJsonPath = options.openclawJsonPath
    this.sidecarPath      = options.sidecarPath
    this._proc            = null
    this._port            = null
  }

  get id()          { return 'data-guard-proxy' }
  get name()        { return 'Data Guard HTTP 代理' }
  get description() { return '本地脱敏反向代理（HTTP 层兜底脱敏），纯 Node.js 引擎，支持 30+ 类脱敏' }

  /**
   * 注册代理服务到 OpenClaw
   * @param {object} api
   * @param {object} config
   * @param {object} logger
   */
  register(api, config, logger) {
    const port           = config.port           ?? 47291
    const blockOnFailure = config.blockOnFailure ?? true

    // 验证脚本文件存在
    if (!existsSync(this.proxyScriptPath)) {
      this.error(logger, `代理脚本不存在: ${this.proxyScriptPath}`)
      return
    }

    // openclawJsonPath 通常是 ~/.openclaw/openclaw.json，其 dirname 即为 openclaw 根目录
    const pidFile = getPidFile(
      this.openclawJsonPath ? join(this.openclawJsonPath, '..') : undefined
    )

    api.registerService({
      id:          this.id,
      name:        this.name,
      description: this.description,

      start: () => {
        // 先清理可能残留的旧代理进程，避免端口占用
        killStalePid(pidFile, logger)
        // 兜底：PID 文件失效时，直接按端口清理残留进程
        killPortProcess(port, logger)

        // 改写 openclaw.json 中的 baseUrl（同时备份原始 URL 到 sidecar）
        syncBaseUrls(this.openclawJsonPath, this.sidecarPath, port, logger)
        this._port = port
        this.log(logger, `启动代理，端口 ${port}`)

        const env = {
          ...process.env,
          DATA_GUARD_PORT:             String(port),
          DATA_GUARD_BLOCK_ON_FAILURE: String(blockOnFailure),
        }

        this._proc = spawn(process.execPath, [this.proxyScriptPath], {
          env,
          stdio:    ['ignore', 'pipe', 'pipe'],
          detached: false,
        })

        this._proc.stdout.on('data', buf => {
          logger?.info(`[proxy] ${buf.toString().trim()}`)
        })
        this._proc.stderr.on('data', buf => {
          logger?.warn(`[proxy] ${buf.toString().trim()}`)
        })
        this._proc.on('exit', (code, signal) => {
          if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
            this.error(logger, `代理进程意外退出，code=${code} signal=${signal}`)
          }
        })
      },

      stop: () => {
        if (this._proc && !this._proc.killed) {
          this.log(logger, '正在停止代理...')
          this._proc.kill('SIGTERM')
          this._proc = null
        }
        // 兜底：如果子进程已成孤儿，通过 PID 文件补杀
        killStalePid(pidFile, logger)
        // 还原 openclaw.json 中的 baseUrl
        restoreBaseUrls(this.openclawJsonPath, this.sidecarPath, this._port ?? port, logger)
      },
    })

    this.log(logger, 'HTTP proxy service registered')
  }
}
