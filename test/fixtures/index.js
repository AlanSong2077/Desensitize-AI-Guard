/**
 * test/fixtures/index.js — 测试用样本数据工厂
 *
 * 提供各层测试所需的标准输入数据，集中管理，避免散落在各测试文件中。
 * 所有 fixture 均为纯数据（Buffer / string / object），不依赖文件系统。
 */

// ── 文本样本 ──────────────────────────────────────────────────────────────────

/** 包含各类敏感信息的纯文本 */
export const SENSITIVE_TEXT = {
  phone:       '联系手机：13812345678',
  email:       '邮箱：user@example.com',
  idCard:      '身份证：110101200001011234',
  bankCard:    '银行卡：4532015112830366',
  ip:          '服务器IP：192.168.1.100',
  passport:    '护照号：E12345678',
  token:       'api_key=sk-abcdefghijklmnop123456',
  mixed:       '姓名：张三，手机：13812345678，邮箱：zhang@corp.com，身份证：110101200001011234',
  clean:       '今天天气不错，适合出门散步。',
  urlParam:    'https://api.example.com/user?phone=13812345678&token=abc123xyz',
  wechat:      '微信号：wxid_abc123def456',
  address:     '收货地址：北京市朝阳区建国路88号',
  company:     '北京科技有限公司签署了合同',
  amount:      '金额：¥128,888.00',
  orderNo:     '订单号：20231201123456789',
}

/** 不含敏感信息的文本（用于验证不误报） */
export const CLEAN_TEXTS = [
  '今天天气不错',
  'Hello World',
  '产品功能说明文档',
  '2023年第四季度工作总结',
  '会议时间：下午3点',
]

// ── CSV 样本 ──────────────────────────────────────────────────────────────────

/** 标准 CSV：含敏感列名，数据行包含真实敏感数据 */
export const CSV_WITH_SENSITIVE_COLS = [
  '姓名,手机,邮箱,身份证号,银行卡号,地址',
  '张三,13812345678,zhang@example.com,110101200001011234,4532015112830366,北京市朝阳区建国路88号',
  '李四,13987654321,li@corp.com,310101200505052345,4111111111111111,上海市浦东新区陆家嘴',
  '王五,15012345678,wang@test.org,440101200001011234,5500005555555559,广州市天河区珠江新城',
].join('\n')

/** CSV：无敏感列名，但数据行含敏感信息（测试兜底正则） */
export const CSV_WITH_SENSITIVE_DATA_NO_HEADER = [
  '编号,备注,描述',
  '001,联系方式13812345678,普通客户',
  '002,邮箱user@example.com,VIP客户',
].join('\n')

/** CSV：完全干净，无任何敏感信息 */
export const CSV_CLEAN = [
  '产品名称,数量,单位,备注',
  '苹果,100,箱,新鲜',
  '香蕉,50,箱,进口',
  '橙子,80,箱,国产',
].join('\n')

/** CSV：含引号转义的复杂格式 */
export const CSV_QUOTED = [
  '姓名,备注',
  '"张三","手机：13812345678，地址：北京市"',
  '"李四","普通用户，无特殊备注"',
].join('\n')

/** CSV：多列混合，部分列敏感、部分列不敏感 */
export const CSV_MIXED_COLS = [
  '订单ID,客户姓名,商品名称,手机,金额,备注',
  'ORD001,张三,苹果手机,13812345678,5999,正常订单',
  'ORD002,李四,笔记本电脑,13987654321,8888,加急处理',
].join('\n')

// ── ParsedFile 样本 ───────────────────────────────────────────────────────────

/** 标准 ParsedFile 结构（单 Sheet） */
export const PARSED_SINGLE_SHEET = {
  sheets: [{
    name: 'Sheet1',
    rows: [
      ['姓名', '手机', '邮箱'],
      ['张三', '13812345678', 'zhang@example.com'],
      ['李四', '13987654321', 'li@corp.com'],
    ],
  }],
}

/** ParsedFile：多 Sheet */
export const PARSED_MULTI_SHEET = {
  sheets: [
    {
      name: '客户信息',
      rows: [
        ['姓名', '手机'],
        ['张三', '13812345678'],
      ],
    },
    {
      name: '订单数据',
      rows: [
        ['订单号', '金额'],
        ['20231201001', '¥1,000.00'],
      ],
    },
  ],
}

/** ParsedFile：空 Sheet */
export const PARSED_EMPTY = {
  sheets: [{ name: 'Sheet1', rows: [] }],
}

// ── HTTP 请求体样本 ───────────────────────────────────────────────────────────

/** OpenAI 格式请求体（含敏感信息） */
export const OPENAI_REQUEST_SENSITIVE = {
  model: 'gpt-4',
  messages: [
    { role: 'system', content: '你是一个助手' },
    { role: 'user',   content: '帮我分析这个客户：张三，手机13812345678，身份证110101199001011234' },
  ],
}

/** Anthropic 格式请求体（含敏感信息） */
export const ANTHROPIC_REQUEST_SENSITIVE = {
  model: 'claude-3',
  system: '你是一个数据分析助手',
  messages: [
    { role: 'user', content: '客户邮箱：user@example.com，银行卡：6222021234567890123' },
  ],
}

/** 完全干净的请求体 */
export const REQUEST_CLEAN = {
  model: 'gpt-4',
  messages: [
    { role: 'user', content: '帮我写一首关于春天的诗' },
  ],
}

// ── 工具调用参数样本 ──────────────────────────────────────────────────────────

export const TOOL_PARAMS = {
  readFile:      { file_path: '/tmp/test.csv' },
  readFilePath:  { path: '/tmp/test.csv' },
  readFileCamel: { filePath: '/tmp/test.csv' },
  readManyFiles: { paths: ['/tmp/a.csv', '/tmp/b.xlsx', '/tmp/c.txt'] },
  readNonFile:   { file_path: '/tmp/test.txt' },
}

// ── skip-guard 样本 ───────────────────────────────────────────────────────────

/** 带 skip-guard 前缀的 OpenAI 请求体（含敏感信息，但应跳过脱敏） */
export const OPENAI_REQUEST_SKIP = {
  model: 'gpt-4',
  messages: [
    { role: 'system', content: '你是一个助手' },
    { role: 'user',   content: '[skip-guard] 帮我分析这个客户：张三，手机13812345678，身份证110101199001011234' },
  ],
}

/** 带 skip-guard 前缀的 Anthropic 请求体（system 字段带前缀） */
export const ANTHROPIC_REQUEST_SKIP_SYSTEM = {
  model: 'claude-3',
  system: '[skip-guard] 你是一个数据分析助手，以下是原始数据',
  messages: [
    { role: 'user', content: '客户邮箱：user@example.com，银行卡：6222021234567890123' },
  ],
}

/** 带 skip-guard 前缀的旧版 prompt 请求体 */
export const REQUEST_SKIP_PROMPT = {
  model: 'text-davinci-003',
  prompt: '[skip-guard] 分析以下数据：手机13812345678',
}

/** content parts 数组格式，第一个 text part 带 skip-guard 前缀 */
export const OPENAI_REQUEST_SKIP_PARTS = {
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '[skip-guard] 请分析这张图片中的数据：手机13812345678' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      ],
    },
  ],
}

/** 自定义前缀的请求体 */
export const OPENAI_REQUEST_CUSTOM_SKIP = {
  model: 'gpt-4',
  messages: [
    { role: 'user', content: '[no-guard] 手机：13812345678' },
  ],
}
