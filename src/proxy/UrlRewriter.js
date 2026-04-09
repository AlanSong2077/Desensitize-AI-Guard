/**
 * src/proxy/UrlRewriter.js — 代理层：Provider baseUrl 改写与还原工具
 *
 * 职责：
 *   启动时：扫描 openclaw.json 中所有 provider 的 baseUrl，
 *           改写为本地代理格式，并将原始 URL 保存到 sidecar 文件。
 *   停止时：从 sidecar 文件读取原始 URL，还原 openclaw.json。
 *
 * 代理格式：
 *   http://127.0.0.1:<port>/proxy/<base64(原始URL)>
 *
 * Sidecar 文件：
 *   ~/.openclaw/data-guard/url-backup.json
 *   格式：{ "<provider路径>": "<原始URL>", ... }
 *   插件停止/卸载后自动删除。
 *
 * 设计原则：
 *   - openclaw.json 的修改必须完全可逆
 *   - 任何时候都能从 sidecar 或代理 URL 本身还原原始地址
 *   - stop() 必须与 start() 对称调用
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const PROXY_HOST = '127.0.0.1'

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')) } catch { return null }
}

function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * 递归收集 JSON 对象中所有 baseUrl 字段的路径和值
 */
function collectProviderBaseUrls(obj, pathArr = [], result = []) {
  if (!obj || typeof obj !== 'object') return result
  for (const [key, val] of Object.entries(obj)) {
    const cur = [...pathArr, key]
    if (key === 'baseUrl' && typeof val === 'string') {
      result.push({ path: pathArr, url: val })
    } else if (typeof val === 'object') {
      collectProviderBaseUrls(val, cur, result)
    }
  }
  return result
}

/**
 * 按路径设置嵌套对象的字段值
 */
function setDeep(obj, pathArr, key, value) {
  let cur = obj
  for (const p of pathArr) {
    if (!cur[p] || typeof cur[p] !== 'object') return
    cur = cur[p]
  }
  cur[key] = value
}

/**
 * 将路径数组序列化为 sidecar key（用于存储和查找）
 */
function pathKey(pathArr) {
  return pathArr.join('.')
}

// ── URL 格式判断 ──────────────────────────────────────────────────────────────

export function isProxyUrl(url, port) {
  return url.startsWith(`http://${PROXY_HOST}:${port}/proxy/`)
}

export function isAnyProxyUrl(url) {
  // 匹配任意端口的代理格式，用于 stop 时兜底识别
  return /^http:\/\/127\.0\.0\.1:\d+\/proxy\//.test(url)
}

export function isLocalProxy(url) {
  try {
    const u = new URL(url)
    return u.hostname === PROXY_HOST || u.hostname === 'localhost'
  } catch { return false }
}

export function encodeProxyUrl(originalUrl, port) {
  const encoded = Buffer.from(originalUrl).toString('base64')
  return `http://${PROXY_HOST}:${port}/proxy/${encoded}`
}

/**
 * 从代理 URL 中解码出原始 URL（兜底方案，不依赖 sidecar）
 */
export function decodeProxyUrl(proxyUrl) {
  try {
    const match = proxyUrl.match(/\/proxy\/([A-Za-z0-9+/=]+)$/)
    if (!match) return null
    return Buffer.from(match[1], 'base64').toString('utf8')
  } catch { return null }
}

// ── 主入口：启动时改写 ────────────────────────────────────────────────────────

/**
 * 扫描并改写 openclaw.json 中所有 provider 的 baseUrl，
 * 同时将原始 URL 保存到 sidecar 文件以便还原。
 *
 * @param {string}  openclawJsonPath  - openclaw.json 文件路径
 * @param {string}  sidecarPath       - 原始 URL 备份文件路径
 * @param {number}  port              - 代理端口
 * @param {object}  [logger]          - 日志对象（可选）
 * @returns {{ changed: number, skipped: number }}
 */
export function syncBaseUrls(openclawJsonPath, sidecarPath, port, logger) {
  if (!existsSync(openclawJsonPath)) {
    return { changed: 0, skipped: 0 }
  }

  const config = readJson(openclawJsonPath)
  if (!config) {
    logger?.warn('[url-rewriter] openclaw.json 解析失败')
    return { changed: 0, skipped: 0 }
  }

  // 读取已有 sidecar（支持重启幂等）
  const sidecar = readJson(sidecarPath) ?? {}

  const entries = collectProviderBaseUrls(config)
  let changed = 0, skipped = 0

  for (const entry of entries) {
    const url = entry.url
    const key = pathKey(entry.path)

    if (isProxyUrl(url, port)) {
      // 已是当前代理格式，确保 sidecar 有记录（兜底）
      if (!sidecar[key]) {
        const decoded = decodeProxyUrl(url)
        if (decoded) sidecar[key] = decoded
      }
      skipped++
      continue
    }

    if (isAnyProxyUrl(url)) {
      // 是其他端口的代理格式（端口变了），先解码还原再重新改写
      const decoded = decodeProxyUrl(url)
      if (decoded) {
        const proxyUrl = encodeProxyUrl(decoded, port)
        setDeep(config, entry.path, 'baseUrl', proxyUrl)
        sidecar[key] = decoded
        changed++
        logger?.info(`[url-rewriter] 代理端口已更新: ${key}`)
      } else {
        logger?.warn(`[url-rewriter] 无法解码旧代理 URL，跳过: ${key}`)
        skipped++
      }
      continue
    }

    if (isLocalProxy(url)) {
      logger?.warn(`[url-rewriter] 发现无法识别的本地代理 URL，跳过: ${key}`)
      skipped++
      continue
    }

    // 正常改写
    try {
      const proxyUrl = encodeProxyUrl(url, port)
      setDeep(config, entry.path, 'baseUrl', proxyUrl)
      sidecar[key] = url   // 保存原始 URL
      changed++
      logger?.info(`[url-rewriter] baseUrl 已改写: ${key}`)
    } catch (e) {
      logger?.warn(`[url-rewriter] baseUrl 改写失败 ${key}: ${e.message}`)
    }
  }

  if (changed > 0) {
    try {
      writeJson(openclawJsonPath, config)
      writeJson(sidecarPath, sidecar)
      logger?.info(`[url-rewriter] openclaw.json 已更新，共改写 ${changed} 个 provider`)
    } catch (e) {
      logger?.warn(`[url-rewriter] 写入失败: ${e.message}`)
    }
  } else {
    // 即使没有新改写，也更新 sidecar（可能补充了兜底记录）
    if (Object.keys(sidecar).length > 0) {
      try { writeJson(sidecarPath, sidecar) } catch {}
    }
    logger?.info(`[url-rewriter] 所有 provider 已就绪，无需改写`)
  }

  return { changed, skipped }
}

// ── 主入口：停止时还原 ────────────────────────────────────────────────────────

/**
 * 还原 openclaw.json 中所有被改写的 baseUrl 为原始值，
 * 并删除 sidecar 文件。
 *
 * @param {string}  openclawJsonPath  - openclaw.json 文件路径
 * @param {string}  sidecarPath       - 原始 URL 备份文件路径
 * @param {number}  port              - 代理端口（用于识别代理 URL）
 * @param {object}  [logger]          - 日志对象（可选）
 * @returns {{ restored: number }}
 */
export function restoreBaseUrls(openclawJsonPath, sidecarPath, port, logger) {
  if (!existsSync(openclawJsonPath)) return { restored: 0 }

  const config = readJson(openclawJsonPath)
  if (!config) return { restored: 0 }

  const sidecar = readJson(sidecarPath) ?? {}
  const entries = collectProviderBaseUrls(config)
  let restored = 0

  for (const entry of entries) {
    const url = entry.url
    const key = pathKey(entry.path)

    // 只处理代理格式的 URL
    if (!isAnyProxyUrl(url)) continue

    // 优先从 sidecar 还原
    let originalUrl = sidecar[key]

    // 兜底：从代理 URL 本身 base64 decode
    if (!originalUrl) {
      originalUrl = decodeProxyUrl(url)
    }

    if (!originalUrl) {
      logger?.warn(`[url-rewriter] 无法还原 ${key}，原始 URL 丢失`)
      continue
    }

    try {
      setDeep(config, entry.path, 'baseUrl', originalUrl)
      restored++
      logger?.info(`[url-rewriter] baseUrl 已还原: ${key}`)
    } catch (e) {
      logger?.warn(`[url-rewriter] baseUrl 还原失败 ${key}: ${e.message}`)
    }
  }

  if (restored > 0) {
    try {
      writeJson(openclawJsonPath, config)
      logger?.info(`[url-rewriter] openclaw.json 已还原，共还原 ${restored} 个 provider`)
    } catch (e) {
      logger?.warn(`[url-rewriter] openclaw.json 写入失败: ${e.message}`)
    }
  }

  // 无论是否还原成功，都删除 sidecar
  try {
    if (existsSync(sidecarPath)) {
      unlinkSync(sidecarPath)
      logger?.info('[url-rewriter] sidecar 文件已清除')
    }
  } catch (e) {
    logger?.warn(`[url-rewriter] sidecar 删除失败: ${e.message}`)
  }

  return { restored }
}
