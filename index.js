/**
 * index.js — Data Guard Unified OpenClaw Plugin 运行时入口
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                     架构分层（由外到内）                              │
 * │                                                                     │
 * │  ┌──────────────────────────────────────────────────────────────┐  │
 * │  │  迁移层 (src/migrate/)                                        │  │
 * │  │  cleanLegacy — 清理旧版 hook/proxy，防止多版本冲突             │  │
 * │  └──────────────────────────────────────────────────────────────┘  │
 * │                                                                     │
 * │  ┌──────────────────────────────────────────────────────────────┐  │
 * │  │  输入层 (src/input/)                                          │  │
 * │  │  FileReader — 读取文件、解析格式、执行脱敏、写临时文件          │  │
 * │  └──────────────────────────────────────────────────────────────┘  │
 * │                                                                     │
 * │  ┌──────────────────────────────────────────────────────────────┐  │
 * │  │  输出层 (src/output/)                                         │  │
 * │  │  TempFileManager — 临时文件生命周期管理                        │  │
 * │  └──────────────────────────────────────────────────────────────┘  │
 * │                                                                     │
 * │  ┌──────────────────────────────────────────────────────────────┐  │
 * │  │  代理层 (src/proxy/)                                          │  │
 * │  │  ProxyServer   — HTTP 反向代理，对 messages 文本兜底脱敏       │  │
 * │  │  UrlRewriter   — 改写 openclaw.json 中的 provider baseUrl     │  │
 * │  └──────────────────────────────────────────────────────────────┘  │
 * │                                                                     │
 * │  ┌──────────────────────────────────────────────────────────────┐  │
 * │  │  插件层 (src/plugins/)                                        │  │
 * │  │  Plugin                — 所有插件的抽象基类                    │  │
 * │  │  ToolPlugin            — 工具调用插件基类                      │  │
 * │  │  ProxyPlugin           — HTTP 代理插件（registerService）      │  │
 * │  │  FileDesensitizePlugin — 文件脱敏（read/read_file 工具层）     │  │
 * │  │  PythonExecPlugin      — Python 脱敏（exec/process 工具层）   │  │
 * │  │  ShellExecPlugin       — Shell/Node/R 脱敏（exec/process）    │  │
 * │  │                                                               │  │
 * │  │  文件格式插件 (src/plugins/tool/formats/)                     │  │
 * │  │  FileFormat    — 格式处理器抽象基类 + 注册表                   │  │
 * │  │  CsvFormat / XlsxFormat / XlsFormat / DocxFormat / ...       │  │
 * │  └──────────────────────────────────────────────────────────────┘  │
 * │                                                                     │
 * │  ┌──────────────────────────────────────────────────────────────┐  │
 * │  │  核心层 (src/core/)                                           │  │
 * │  │  desensitize — 脱敏引擎（30+ 类规则，零外部依赖）              │  │
 * │  └──────────────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * 四层互补，无冲突：
 *   - FileDesensitizePlugin  在工具层先脱敏文件内容（read 工具）
 *   - PythonExecPlugin       在工具层拦截 Python exec 中的文件读取
 *   - ShellExecPlugin        在工具层拦截 Shell/Node/Ruby/R 等 exec 中的文件读取
 *   - ProxyPlugin            在 HTTP 层对 messages 文本兜底脱敏
 *   - 四层共享同一份 desensitize 引擎，逻辑完全一致
 */

import { join, dirname }    from 'path'
import { fileURLToPath }    from 'url'
import { homedir }          from 'os'
import { ProxyPlugin }           from './src/plugins/ProxyPlugin.js'
import { FileDesensitizePlugin } from './src/plugins/tool/FileDesensitizePlugin.js'
import { PythonExecPlugin }      from './src/plugins/exec/PythonExecPlugin.js'
import { ShellExecPlugin }       from './src/plugins/exec/ShellExecPlugin.js'
import { cleanLegacy }           from './src/migrate/cleanLegacy.js'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = __dirname

// ── 跨平台路径解析 ────────────────────────────────────────────────────────────

function getOpenClawDir() {
  const home = homedir()
  if (process.env.OPENCLAW_DIR) return process.env.OPENCLAW_DIR
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || home, '.openclaw')
  }
  return join(home, '.openclaw')
}

// ── Plugin 注册入口 ───────────────────────────────────────────────────────────

export function register(api) {
  // ── 读取配置 ──────────────────────────────────────────────────────────────
  const pluginConfig = api.config?.plugins?.entries?.['data-guard']?.config ?? {}

  const port               = pluginConfig.port           ?? 47291
  const blockOnFailure     = pluginConfig.blockOnFailure ?? true
  const fileGuardEnabled   = pluginConfig.fileGuard      ?? true
  const pythonGuardEnabled = pluginConfig.pythonGuard    ?? true
  const shellGuardEnabled  = pluginConfig.shellGuard     ?? true

  const openclawDir  = getOpenClawDir()
  const openclawJson = join(openclawDir, 'openclaw.json')
  const tempDir      = join(openclawDir, 'data-guard', 'tmp')
  const sidecarPath  = join(openclawDir, 'data-guard', 'url-backup.json')
  const proxyScript  = join(PLUGIN_DIR, 'src', 'proxy', 'proxy-process.js')

  const logger = api.logger

  // ── 步骤 0：清理旧版（防止多版本冲突）────────────────────────────────────
  cleanLegacy(openclawDir, logger)

  // ── 层 1：注册 HTTP 代理插件 ──────────────────────────────────────────────
  const proxyPlugin = new ProxyPlugin({
    proxyScriptPath:  proxyScript,
    openclawJsonPath: openclawJson,
    sidecarPath:      sidecarPath,
  })
  proxyPlugin.register(api, { port, blockOnFailure }, logger)

  // ── 层 2：注册文件脱敏插件（read/read_file/read_many_files 工具层）────────
  if (!fileGuardEnabled) {
    logger?.info('[data-guard] 文件脱敏层已禁用（fileGuard=false）')
  } else {
    const filePlugin = new FileDesensitizePlugin(tempDir)
    filePlugin.register(api, pluginConfig, logger)
  }

  // ── 层 3：注册 Python exec 脱敏插件（exec/process 工具层）────────────────
  if (!pythonGuardEnabled) {
    logger?.info('[data-guard] Python exec 脱敏层已禁用（pythonGuard=false）')
  } else {
    const pythonPlugin = new PythonExecPlugin(tempDir)
    pythonPlugin.register(api, pluginConfig, logger)
  }

  // ── 层 4：注册 Shell exec 脱敏插件（cat/head/awk/node/Rscript 等）────────
  if (!shellGuardEnabled) {
    logger?.info('[data-guard] Shell exec 脱敏层已禁用（shellGuard=false）')
  } else {
    const shellPlugin = new ShellExecPlugin(tempDir)
    shellPlugin.register(api, pluginConfig, logger)
  }

  logger?.info('[data-guard] registered (HTTP proxy layer + file tool layer + python exec layer + shell exec layer)')
}
