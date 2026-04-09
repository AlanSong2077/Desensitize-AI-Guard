/**
 * src/plugins/base/ToolPlugin.js — 工具调用插件基类
 *
 * 继承自 Plugin，专门用于拦截 AI 工具调用（before_tool_call hook）。
 *
 * 子类只需实现：
 *   - supportedTools   → 声明要拦截的工具名列表
 *   - handleToolCall() → 处理工具调用，返回修改后的 params 或 undefined
 *
 * 框架会自动完成 hook 注册和工具名过滤。
 *
 * 使用示例：
 *   class FileDesensitizePlugin extends ToolPlugin {
 *     get id()             { return 'file-desensitize' }
 *     get name()           { return '文件脱敏' }
 *     get supportedTools() { return ['read', 'read_file', 'read_many_files'] }
 *
 *     handleToolCall(toolName, params, config, logger) {
 *       // 处理文件读取，返回 { params: newParams } 或 undefined
 *     }
 *   }
 */

import { Plugin } from './Plugin.js'

export class ToolPlugin extends Plugin {
  /**
   * 声明此插件要拦截的工具名列表（子类必须实现）
   * @returns {string[]}
   */
  get supportedTools() {
    throw new Error(`ToolPlugin.supportedTools must be implemented by ${this.constructor.name}`)
  }

  /**
   * 处理工具调用（子类必须实现）
   *
   * @param {string} toolName   - 工具名
   * @param {object} params     - 工具参数
   * @param {object} config     - 插件配置
   * @param {object} logger     - 日志对象
   * @returns {{ params: object } | undefined}
   *   返回 { params: newParams } 表示修改参数；返回 undefined 表示不修改
   */
  handleToolCall(toolName, params, config, logger) {
    throw new Error(`ToolPlugin.handleToolCall() must be implemented by ${this.constructor.name}`)
  }

  /**
   * 注册 before_tool_call hook（框架自动调用，子类通常不需要覆盖）
   *
   * @param {object} api
   * @param {object} config
   * @param {object} logger
   */
  register(api, config, logger) {
    const tools = this.supportedTools

    api.on('before_tool_call', (event) => {
      const { toolName, params } = event

      // 只处理声明的工具
      if (!tools.includes(toolName)) return

      return this.handleToolCall(toolName, params, config, logger)
    })

    this.log(logger, `registered, intercepting tools: [${tools.join(', ')}]`)
  }
}
