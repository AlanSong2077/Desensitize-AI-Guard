/**
 * Reversible Guard - 可逆脱敏模块
 * 在 LLM 调用前加密敏感数据，返回后解密
 * @module ReversibleGuard
 * @version 2.3.0
 */

import crypto from 'crypto';

/**
 * 敏感数据类型定义
 */
const PII_PATTERNS = {
  email: {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    type: 'EMAIL'
  },
  phone: {
    pattern: /\b1[3-9]\d{9}\b/g,
    type: 'PHONE'
  },
  idCard: {
    pattern: /\b\d{17}[\dXx]\b/g,
    type: 'ID_CARD'
  },
  bankCard: {
    pattern: /\b\d{16,19}\b/g,
    type: 'BANK_CARD'
  },
  ipAddress: {
    pattern: /\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    type: 'IP'
  },
  apiKey: {
    pattern: /\b(?:sk-|pk-|ak-|api[_-]?key|token)[\w\-]{20,}\b/gi,
    type: 'API_KEY'
  }
};

/**
 * 可逆脱敏引擎
 */
class ReversibleGuard {
  constructor(options = {}) {
    this.algorithm = options.algorithm || 'aes-256-gcm';
    this.key = this._deriveKey(options.password || 'default-password-change-it');
    this.tokenPrefix = options.tokenPrefix || '<ENC>';
    this.tokenSuffix = options.tokenSuffix || '</ENC>';
    this.enabledTypes = options.enabledTypes || Object.keys(PII_PATTERNS);
    this.tokenMap = new Map(); // 内存中的 token 映射表
    this.persistPath = options.persistPath || null; // 持久化路径
  }

  /**
   * 从密码派生加密密钥
   */
  _deriveKey(password) {
    return crypto.scryptSync(password, 'salt', 32);
  }

  /**
   * 加密单个值
   */
  _encrypt(value) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    const combined = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    
    // 转为 base64 使其更短
    return Buffer.from(combined).toString('base64url');
  }

  /**
   * 解密单个值
   */
  _decrypt(token) {
    try {
      const combined = Buffer.from(token, 'base64url').toString('utf8');
      const [ivHex, authTagHex, encrypted] = combined.split(':');
      
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (err) {
      console.error('[ReversibleGuard] Decryption failed:', err.message);
      return null;
    }
  }

  /**
   * 生成唯一 Token ID
   */
  _generateTokenId(type, index) {
    return `${this.tokenPrefix}${type}_${Date.now()}_${index}${this.tokenSuffix}`;
  }

  /**
   * 预处理：识别并加密敏感数据
   */
  preProcess(text) {
    if (!text || typeof text !== 'string') return text;
    
    let processedText = text;
    const tokenTable = [];
    let globalIndex = 0;

    for (const [typeName, config] of Object.entries(PII_PATTERNS)) {
      if (!this.enabledTypes.includes(typeName)) continue;

      const matches = [...text.matchAll(config.pattern)];
      
      for (const match of matches) {
        const originalValue = match[0];
        const position = match.index;
        
        // 加密原始值
        const encryptedValue = this._encrypt(originalValue);
        
        // 生成 token
        const tokenId = this._generateTokenId(config.type, globalIndex++);
        
        // 保存映射关系
        this.tokenMap.set(tokenId, {
          encrypted: encryptedValue,
          type: config.type,
          originalLength: originalValue.length
        });
        
        tokenTable.push({
          token: tokenId,
          original: originalValue,
          position: position,
          type: config.type
        });
      }
    }

    // 按位置倒序排序，从后向前替换（避免位置偏移）
    tokenTable.sort((a, b) => b.position - a.position);
    
    // 替换文本
    for (const item of tokenTable) {
      processedText = processedText.slice(0, item.position) + 
                      item.token + 
                      processedText.slice(item.position + item.original.length);
    }

    console.log(`[ReversibleGuard] Pre-process: ${tokenTable.length} PII items encrypted`);
    
    return {
      text: processedText,
      tokenCount: tokenTable.length,
      tokenTable: tokenTable
    };
  }

  /**
   * 后处理：解密还原敏感数据
   */
  postProcess(text) {
    if (!text || typeof text !== 'string') return text;
    
    let processedText = text;
    let decryptedCount = 0;

    // 匹配所有 token
    const tokenPattern = new RegExp(
      `${this.tokenPrefix.replace(/[<>]/g, '\\$&')}[A-Z_]+_\\d+_\\d+${this.tokenSuffix.replace(/[<>]/g, '\\$&')}`, 
      'g'
    );
    
    const matches = [...text.matchAll(tokenPattern)];
    
    // 按位置倒序排序
    const sortedMatches = matches.sort((a, b) => b.index - a.index);
    
    for (const match of sortedMatches) {
      const tokenId = match[0];
      const mapping = this.tokenMap.get(tokenId);
      
      if (mapping) {
        const decryptedValue = this._decrypt(mapping.encrypted);
        if (decryptedValue) {
          processedText = processedText.slice(0, match.index) + 
                          decryptedValue + 
                          processedText.slice(match.index + tokenId.length);
          decryptedCount++;
          
          // 清理已使用的 token（可选）
          this.tokenMap.delete(tokenId);
        }
      }
    }

    console.log(`[ReversibleGuard] Post-process: ${decryptedCount} tokens decrypted`);
    
    return {
      text: processedText,
      decryptedCount: decryptedCount
    };
  }

  /**
   * 清理所有 token（会话结束调用）
   */
  clearSession() {
    const count = this.tokenMap.size;
    this.tokenMap.clear();
    console.log(`[ReversibleGuard] Session cleared: ${count} tokens removed`);
  }

  /**
   * 获取当前 token 统计
   */
  getStats() {
    const stats = {};
    for (const [tokenId, data] of this.tokenMap) {
      stats[data.type] = (stats[data.type] || 0) + 1;
    }
    return {
      totalTokens: this.tokenMap.size,
      byType: stats
    };
  }
}

/**
 * OpenClaw 插件集成
 */
class OpenClawReversibleGuard {
  constructor(options = {}) {
    this.guard = new ReversibleGuard(options);
    this.sessionId = null;
  }

  /**
   * 初始化插件
   */
  init(sessionId) {
    this.sessionId = sessionId;
    console.log(`[OpenClawReversibleGuard] Initialized for session: ${sessionId}`);
  }

  /**
   * 处理进入 LLM 的消息
   */
  onBeforeSend(message) {
    if (typeof message === 'string') {
      const result = this.guard.preProcess(message);
      return result.text;
    }
    
    if (message.content) {
      const result = this.guard.preProcess(message.content);
      message.content = result.text;
    }
    
    return message;
  }

  /**
   * 处理 LLM 返回的响应
   */
  onAfterReceive(response) {
    if (typeof response === 'string') {
      const result = this.guard.postProcess(response);
      return result.text;
    }
    
    if (response.content) {
      const result = this.guard.postProcess(response.content);
      response.content = result.text;
    }
    
    if (response.choices && response.choices[0]) {
      const choice = response.choices[0];
      if (choice.message && choice.message.content) {
        const result = this.guard.postProcess(choice.message.content);
        choice.message.content = result.text;
      }
    }
    
    return response;
  }

  /**
   * 会话结束
   */
  onSessionEnd() {
    this.guard.clearSession();
    console.log(`[OpenClawReversibleGuard] Session ${this.sessionId} ended`);
  }
}

/**
 * HTTP 代理层集成示例
 */
function createReversibleProxy(options = {}) {
  const guard = new OpenClawReversibleGuard(options);
  
  return {
    name: 'reversible-guard',
    
    async onRequest(request) {
      // 提取消息内容
      const messages = request.body?.messages || [];
      
      for (const msg of messages) {
        if (msg.content) {
          const result = guard.guard.preProcess(msg.content);
          msg.content = result.text;
          console.log(`[Proxy] Encrypted ${result.tokenCount} PII items`);
        }
      }
      
      return request;
    },
    
    async onResponse(response) {
      // 解密响应中的 token
      if (response.choices) {
        for (const choice of response.choices) {
          if (choice.message?.content) {
            const result = guard.guard.postProcess(choice.message.content);
            choice.message.content = result.text;
            console.log(`[Proxy] Decrypted ${result.decryptedCount} tokens`);
          }
        }
      }
      
      return response;
    }
  };
}

// 导出模块
export {
  ReversibleGuard,
  OpenClawReversibleGuard,
  createReversibleProxy,
  PII_PATTERNS
};

// 默认导出
export default ReversibleGuard;
