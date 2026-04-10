/**
 * Reversible Guard - 使用示例
 * 演示如何在 OpenClaw 中使用可逆脱敏
 */

import { ReversibleGuard, OpenClawReversibleGuard, createReversibleProxy } from './reversible-guard.js';

// ==================== 示例 1: 基础使用 ====================
console.log('=== Example 1: Basic Usage ===\n');

const guard = new ReversibleGuard({
  password: 'my-secret-password',
  enabledTypes: ['email', 'phone', 'idCard']
});

// 模拟用户输入（包含敏感信息）
const userInput = `
  用户信息：
  姓名：张三
  邮箱：zhangsan@example.com
  电话：13800138000
  身份证：110101199001011234
  
  请帮我分析这个用户的信用风险。
`;

console.log('原始输入：');
console.log(userInput);
console.log('\n---\n');

// 预处理：加密敏感数据
const preResult = guard.preProcess(userInput);
console.log('预处理后（发送给 LLM）：');
console.log(preResult.text);
console.log(`\n加密了 ${preResult.tokenCount} 个敏感项\n`);
console.log('Token 映射表：', preResult.tokenTable);
console.log('\n---\n');

// 模拟 LLM 响应
const llmResponse = `
  根据您提供的用户信息：
  - 邮箱：<ENC>EMAIL_1744358901_0</ENC>
  - 电话：<ENC>PHONE_1744358901_1</ENC>
  - 身份证：<ENC>ID_CARD_1744358901_2</ENC>
  
  该用户的信用风险评级为：A级（低风险）
  建议额度：50000元
`;

console.log('LLM 原始响应：');
console.log(llmResponse);
console.log('\n---\n');

// 后处理：解密还原
const postResult = guard.postProcess(llmResponse);
console.log('解密后（返回给用户）：');
console.log(postResult.text);
console.log(`\n解密了 ${postResult.decryptedCount} 个 token\n`);

// ==================== 示例 2: OpenClaw 集成 ====================
console.log('\n=== Example 2: OpenClaw Integration ===\n');

const openclawGuard = new OpenClawReversibleGuard({
  password: process.env.GUARD_PASSWORD || 'change-me',
  enabledTypes: ['email', 'phone', 'idCard', 'bankCard', 'apiKey']
});

// 模拟 OpenClaw 会话
openclawGuard.init('session-12345');

// 模拟用户消息
const userMessage = {
  role: 'user',
  content: '我的银行卡号 6222021234567890123 被盗刷了，联系邮箱是 test@bank.com'
};

console.log('用户消息：', userMessage);

// 发送前处理
const processedMessage = openclawGuard.onBeforeSend(userMessage);
console.log('处理后消息：', processedMessage);

// 模拟 LLM 响应
const llmRawResponse = {
  choices: [{
    message: {
      role: 'assistant',
      content: '我们已记录您的银行卡号 <ENC>BANK_CARD_1744358901_0</ENC>，会发送确认邮件到 <ENC>EMAIL_1744358901_1</ENC>。'
    }
  }]
};

console.log('\nLLM 原始响应：', JSON.stringify(llmRawResponse, null, 2));

// 接收后处理
const finalResponse = openclawGuard.onAfterReceive(llmRawResponse);
console.log('\n解密后响应：', JSON.stringify(finalResponse, null, 2));

// 结束会话
openclawGuard.onSessionEnd();

// ==================== 示例 3: HTTP 代理层集成 ====================
console.log('\n=== Example 3: HTTP Proxy Layer ===\n');

const proxy = createReversibleProxy({
  password: 'proxy-secret-key',
  enabledTypes: ['email', 'phone', 'ipAddress', 'apiKey']
});

// 模拟 HTTP 请求
const mockRequest = {
  body: {
    model: 'gpt-4',
    messages: [
      { role: 'system', content: '你是一个安全助手' },
      { role: 'user', content: '我的 IP 是 192.168.1.1，API Key 是 sk-1234567890abcdef' }
    ]
  }
};

console.log('原始请求：');
console.log(JSON.stringify(mockRequest, null, 2));

// 处理请求
proxy.onRequest(mockRequest).then(processedReq => {
  console.log('\n处理后请求：');
  console.log(JSON.stringify(processedReq, null, 2));
  
  // 模拟 LLM 响应
  const mockResponse = {
    choices: [{
      message: {
        content: '已记录您的请求，IP <ENC>IP_1744358901_0</ENC> 和 API Key <ENC>API_KEY_1744358901_1</ENC> 已加密存储。'
      }
    }]
  };
  
  console.log('\nLLM 响应：');
  console.log(JSON.stringify(mockResponse, null, 2));
  
  // 处理响应
  return proxy.onResponse(mockResponse);
}).then(finalRes => {
  console.log('\n解密后响应：');
  console.log(JSON.stringify(finalRes, null, 2));
});

// ==================== 示例 4: 配置选项 ====================
console.log('\n=== Example 4: Configuration Options ===\n');

// 自定义配置
const customGuard = new ReversibleGuard({
  // 加密算法
  algorithm: 'aes-256-gcm',
  
  // 加密密码（重要：生产环境使用强密码或从环境变量读取）
  password: process.env.ENCRYPTION_KEY || 'default-password',
  
  // Token 标记格式
  tokenPrefix: '<PII>',
  tokenSuffix: '</PII>',
  
  // 启用的检测类型
  enabledTypes: ['email', 'phone', 'idCard', 'bankCard', 'ipAddress', 'apiKey'],
  
  // 持久化路径（可选，用于跨会话恢复）
  persistPath: './token-store.json'
});

console.log('Guard stats:', customGuard.getStats());

// ==================== 安全提示 ====================
console.log('\n=== Security Notes ===\n');
console.log(`
1. 密码管理：
   - 生产环境使用强密码（至少 32 字符）
   - 从环境变量读取，不要硬编码
   - 定期更换密码

2. Token 生命周期：
   - 会话结束后自动清理
   - 支持持久化存储（可选）
   - 内存中存储，进程重启丢失

3. 加密安全：
   - 使用 AES-256-GCM 认证加密
   - 每次加密使用随机 IV
   - 防止重放攻击

4. 局限性：
   - Token 可能被 LLM 误解为指令
   - 复杂格式数据可能需要额外处理
   - 加密/解密有性能开销
`);
