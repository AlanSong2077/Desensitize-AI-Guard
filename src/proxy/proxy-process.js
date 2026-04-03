#!/usr/bin/env node
/**
 * src/proxy/proxy-process.js — 代理子进程入口
 *
 * 此文件由 ProxyPlugin 以子进程方式启动（spawn）。
 * 从环境变量读取配置，启动 ProxyServer，并处理进程信号。
 *
 * 孤儿进程防护（双保险）：
 *   1. 父进程心跳检测：每 5 秒探测父进程是否存活，父进程退出后自动关闭
 *   2. PID 文件：写入自身 PID，供 ProxyPlugin 下次启动时清理残留进程
 *
 * 环境变量：
 *   DATA_GUARD_PORT             - 监听端口（默认 47291）
 *   DATA_GUARD_BLOCK_ON_FAILURE - 脱敏失败时是否阻断（默认 true）
 *   OPENCLAW_DIR                - OpenClaw 配置目录（可选）
 */

import { homedir } from 'os'
import { join }    from 'path'
import { mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { ProxyServer } from './ProxyServer.js'

// ── 读取配置 ──────────────────────────────────────────────────────────────────

const port           = parseInt(process.env.DATA_GUARD_PORT ?? '47291', 10)
const blockOnFailure = (process.env.DATA_GUARD_BLOCK_ON_FAILURE ?? 'true') !== 'false'
const skipPrefix     = process.env.DATA_GUARD_SKIP_PREFIX ?? '[skip-guard]'

// ── 路径解析 ──────────────────────────────────────────────────────────────────

function getDataGuardDir() {
  const home = homedir()
  if (process.env.OPENCLAW_DIR) return join(process.env.OPENCLAW_DIR, 'data-guard')
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || home, '.openclaw', 'data-guard')
  }
  return join(home, '.openclaw', 'data-guard')
}

const dataGuardDir = getDataGuardDir()
try { mkdirSync(dataGuardDir, { recursive: true }) } catch {}

const logFile = join(dataGuardDir, 'proxy.log')
const pidFile = join(dataGuardDir, 'proxy.pid')

// ── 写入 PID ──────────────────────────────────────────────────────────────────

try { writeFileSync(pidFile, String(process.pid), 'utf8') } catch {}

// ── 启动代理 ──────────────────────────────────────────────────────────────────

const server = new ProxyServer({ port, blockOnFailure, skipPrefix, logFile })

server.start().catch(err => {
  process.stderr.write(`[proxy-process] 启动失败: ${err.message}\n`)
  process.exit(1)
})

// ── 父进程心跳检测 ────────────────────────────────────────────────────────────
// 每 5 秒探测一次父进程是否还活着。
// 父进程（gateway）退出后，process.ppid 会变成 1（被 init 接管），
// 此时子进程主动关闭，避免成为孤儿进程继续占用端口。

const PARENT_PID   = process.ppid
const HEARTBEAT_MS = 5_000

const heartbeatTimer = setInterval(() => {
  try {
    process.kill(PARENT_PID, 0)   // 信号 0：仅探测存活，不实际发送
  } catch (e) {
    if (e.code === 'ESRCH') {
      // 父进程已不存在，主动退出
      process.stdout.write(`[proxy-process] 父进程 PID=${PARENT_PID} 已退出，代理自动关闭\n`)
      clearInterval(heartbeatTimer)
      server.stop().finally(() => {
        try { unlinkSync(pidFile) } catch {}
        process.exit(0)
      })
    }
    // EPERM = 进程存在但无权限发信号（不应发生，忽略）
  }
}, HEARTBEAT_MS)

// unref：心跳 timer 不阻止进程在其他任务完成后正常退出
heartbeatTimer.unref()

// ── 信号处理 ──────────────────────────────────────────────────────────────────

async function shutdown(signal) {
  process.stdout.write(`[proxy-process] 收到 ${signal}，正在关闭...\n`)
  clearInterval(heartbeatTimer)
  await server.stop()
  try { unlinkSync(pidFile) } catch {}
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
