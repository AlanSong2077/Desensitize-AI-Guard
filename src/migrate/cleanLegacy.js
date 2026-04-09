/**
 * src/migrate/cleanLegacy.js — 旧版清理模块
 *
 * 在插件 register() 时自动检测并清除所有已知的旧版 data-guard 实现，
 * 避免多版本并存导致的逻辑冲突。
 *
 * 清理目标：
 *   1. hooks/data-guard  — 早期 hook 版本（依赖 Python 脚本）
 *   2. data-guard-proxy  — 早期独立代理目录（已被 extensions/data-guard 取代）
 *
 * 设计原则：
 *   - 只删文件，不动 openclaw.json
 *   - openclaw.json 由 openclaw 自身管理，插件不应直接修改
 *   - 旧版 hook 文件删除后，openclaw 加载时找不到文件会自动跳过，无需手动禁用配置
 */

import { existsSync, rmSync } from 'fs'
import { join } from 'path'

// ── 主入口 ────────────────────────────────────────────────────────────────────

/**
 * 执行全量旧版清理
 *
 * @param {string} openclawDir - ~/.openclaw 目录路径
 * @param {object} logger      - OpenClaw logger 对象
 */
export function cleanLegacy(openclawDir, logger) {
  let cleaned = false

  // 1. 自动删除旧版 hook 目录
  const legacyHookDir = join(openclawDir, 'hooks', 'data-guard')
  if (existsSync(legacyHookDir)) {
    try {
      rmSync(legacyHookDir, { recursive: true, force: true })
      logger?.info('[data-guard] 已自动删除旧版 hook 目录: ~/.openclaw/hooks/data-guard/ ✓')
    } catch (e) {
      logger?.warn(`[data-guard] 删除旧版 hook 目录失败: ${e.message}`)
    }
    cleaned = true
  }

  // 2. 自动删除旧版独立代理目录
  const legacyProxyDir = join(openclawDir, 'data-guard-proxy')
  if (existsSync(legacyProxyDir)) {
    try {
      rmSync(legacyProxyDir, { recursive: true, force: true })
      logger?.info('[data-guard] 已自动删除旧版代理目录: ~/.openclaw/data-guard-proxy/ ✓')
    } catch (e) {
      logger?.warn(`[data-guard] 删除旧版代理目录失败: ${e.message}`)
    }
    cleaned = true
  }

  if (cleaned) {
    logger?.info('[data-guard] 旧版兼容性检查完成 ✓')
  }
}
