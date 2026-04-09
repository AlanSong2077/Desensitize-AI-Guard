/**
 * src/plugins/exec/ShellExecPlugin.js — Shell exec 调用脱敏插件
 *
 * 拦截 exec / process 工具调用，检测其中的 Shell 文件读取操作，
 * 在命令执行前将目标文件替换为脱敏后的临时副本。
 *
 * 覆盖场景（非 Python 的其他读取方式）：
 *   Shell 工具：
 *     cat /data/clients.csv
 *     head -n 100 /data/report.xlsx
 *     tail -n 50 /data/data.csv
 *     less /data/clients.csv
 *     more /data/clients.csv
 *     awk -F, '{print $2}' /data/clients.csv
 *     sed 's/foo/bar/' /data/clients.csv
 *     cut -d, -f1,3 /data/clients.csv
 *     grep "keyword" /data/clients.csv
 *     sort /data/clients.csv
 *     wc -l /data/clients.csv
 *     diff /data/a.csv /data/b.csv
 *   Node.js：
 *     node -e "require('fs').readFileSync('/data/clients.csv')"
 *     node script.js /data/clients.csv
 *   Ruby：
 *     ruby -e "File.read('/data/clients.csv')"
 *   R：
 *     Rscript -e "read.csv('/data/clients.csv')"
 *     Rscript script.R /data/clients.csv
 *   其他语言：
 *     perl -ne 'print' /data/clients.csv
 *     php script.php /data/clients.csv
 *
 * 工作原理：
 *   1. 判断命令是否属于 Shell/其他语言读取（排除已由 PythonExecPlugin 处理的 Python 命令）
 *   2. 从命令字符串中提取所有支持格式的文件路径
 *   3. 对每个路径调用 readAndDesensitize() 生成脱敏临时文件
 *   4. 将命令字符串中的原始路径替换为临时文件路径
 *   5. 执行替换后的命令，读到的就是脱敏数据
 */

import { ToolPlugin }      from '../base/ToolPlugin.js'
import { TempFileManager } from '../../output/TempFileManager.js'
import { desensitizePaths } from './execUtils.js'

// ── Shell / 其他语言命令检测 ──────────────────────────────────────────────────

/**
 * 判断命令是否是 Python 调用（与 PythonExecPlugin 保持一致，用于排除）
 * @param {string} cmd
 * @returns {boolean}
 */
function isPythonCommand(cmd) {
  return /(?:^|\s|;|&&|\|)python3?(?:\s|$)/.test(cmd) ||
         /(?:^|\s|;|&&|\|)py(?:\s|$)/.test(cmd) ||
         /(?:import\s+pandas|import\s+csv|import\s+polars|pd\.read_|pl\.read_|open\s*\()/.test(cmd)
}

/**
 * Shell 文件读取命令关键词
 * 只要命令中出现这些词，就认为可能在读取文件
 */
const SHELL_READ_CMDS = [
  // 文本查看
  'cat', 'head', 'tail', 'less', 'more', 'tac', 'nl',
  // 文本处理
  'awk', 'gawk', 'mawk', 'sed', 'grep', 'egrep', 'fgrep', 'rg', 'ripgrep',
  'cut', 'sort', 'uniq', 'wc', 'tr', 'paste', 'join', 'comm', 'diff', 'cmp',
  'strings', 'od', 'xxd', 'hexdump',
  // 文件操作（可能读取内容）
  'cp', 'mv',
  // 其他语言解释器
  'node', 'nodejs', 'deno', 'bun',
  'ruby', 'gem',
  'Rscript', 'rscript',
  'perl', 'perl5',
  'php',
  'lua',
  'julia',
  'swift',
  'go run',
  'java', 'javac',
  'scala',
  'kotlin',
  // 数据处理工具
  'jq', 'yq', 'mlr', 'miller', 'csvkit', 'csvtool', 'xsv',
  'sqlite3', 'mysql', 'psql',
  // 压缩/解压（可能读取内容）
  'zcat', 'gzcat', 'bzcat', 'xzcat',
]

// 构建快速检测正则（命令开头或分隔符后出现）
const SHELL_CMD_RE = new RegExp(
  '(?:^|[\\s;|&`(])(' +
  SHELL_READ_CMDS.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
  ')(?:\\s|$)',
  'i'
)

/**
 * 判断命令是否是 Shell / 其他语言读取操作
 * 排除 Python（由 PythonExecPlugin 处理）
 *
 * @param {string} cmd
 * @returns {boolean}
 */
function isShellReadCommand(cmd) {
  if (typeof cmd !== 'string') return false
  if (isPythonCommand(cmd)) return false   // 交给 PythonExecPlugin
  return SHELL_CMD_RE.test(cmd)
}

// ── ShellExecPlugin ───────────────────────────────────────────────────────────

export class ShellExecPlugin extends ToolPlugin {
  /**
   * @param {string} tempDir - 临时文件目录
   */
  constructor(tempDir) {
    super()
    this.tempDir     = tempDir
    this.tempManager = new TempFileManager(tempDir)
  }

  get id()   { return 'shell-exec-desensitize' }
  get name() { return 'Shell Exec Desensitization' }
  get description() {
    return '拦截 exec/process 工具中的 Shell/Node/Ruby/R 等文件读取操作，在执行前将目标文件替换为脱敏临时副本。'
  }

  get supportedTools() {
    return ['exec', 'process']
  }

  handleToolCall(toolName, params, config, logger) {
    const cmd = params?.command ?? params?.cmd ?? params?.script ?? ''
    if (!cmd || typeof cmd !== 'string') return
    if (!isShellReadCommand(cmd)) return

    const { newCmd, totalHits, replaced } = desensitizePaths(
      cmd, this.tempDir, this.tempManager, logger, 'Shell exec'
    )
    if (totalHits === 0) return

    const newParams = { ...params }
    if ('command' in params)     newParams.command = newCmd
    else if ('cmd' in params)    newParams.cmd     = newCmd
    else if ('script' in params) newParams.script  = newCmd

    logger?.info(`[shell-exec-desensitize] 脱敏完成，共替换 ${replaced.length} 个文件: ${replaced.join(', ')}`)
    return { params: newParams }
  }

  register(api, config, logger) {
    const stale = this.tempManager.cleanupStale()
    if (stale > 0) logger?.info(`[shell-exec-desensitize] 清理了 ${stale} 个过期临时文件`)
    super.register(api, config, logger)
  }
}
