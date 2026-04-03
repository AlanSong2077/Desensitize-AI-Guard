/**
 * src/core/desensitize.js — 脱敏引擎（纯 Node.js，零外部依赖）
 *
 * 覆盖 30+ 类敏感信息：手机号、身份证、护照、港澳台通行证、驾照、社保卡、公积金号、
 * 银行卡、统一社会信用代码、邮箱、IPv4/IPv6、token/密码、URL敏感参数、微信/QQ、
 * 合同编号、订单/流水号、发票号码、姓名、地址、企业/集团/基金名称、金额、比率、
 * 供应商/客户、部门/项目、出生日期、年龄、车牌号、工号、
 * 估值/融资/营收/利润等金融数字（放缩脱敏）
 *
 * 导出：
 *   desensitize(text)               → { result: string, stats: Record<string,number> }
 *   mightContainSensitiveData(text) → boolean
 *   makeCtx()                       → DesensitizeContext
 *   CSV_COLUMN_RULES                → 列名规则表（供 FileFormat 插件复用）
 *   各 mask* 函数                   → 供外部直接调用
 */

import { createHash } from 'crypto'

// ── 上下文工厂 ────────────────────────────────────────────────────────────────

export function makeCtx() {
  return {
    nameMap:     new Map(),
    companyMap:  new Map(),
    vendorMap:   new Map(),
    deptMap:     new Map(),
    projectMap:  new Map(),
    amountScale: Math.round((0.3 + Math.random() * 0.4) * 10000) / 10000,
    stats: {},
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

export function hit(ctx, key) { ctx.stats[key] = (ctx.stats[key] ?? 0) + 1 }
export function sha8(v) { return createHash('sha256').update(v).digest('hex').slice(0, 8) }

/**
 * 将含分隔符的数字串还原为纯数字
 * 支持：空格、全角空格、-、/、\、.（非小数点场景）、换行
 */
function stripSep(v) { return v.replace(/[\s\u3000\-\/\\.\\\\]/g, '') }

// ── 各类脱敏函数（纯函数，无副作用）─────────────────────────────────────────

export function maskPhone(v) {
  const d = stripSep(v).replace(/[^\d]/g, '')
  if (d.length === 11 && /^1[3-9]/.test(d)) return d.slice(0, 3) + '****' + d.slice(7)
  if (d.length === 10 && /^[2-9]/.test(d))  return d.slice(0, 3) + '****' + d.slice(-4)
  if (d.length >= 7) return d.slice(0, 3) + '*'.repeat(Math.min(d.length - 7, 6)) + d.slice(-4)
  return v
}

export function maskIdCard(v, type = 'cnic') {
  if (type === 'cnic')  return v.slice(0, 3) + '*'.repeat(11) + v.slice(-4)
  if (type === 'hic')   return v.slice(0, 3) + '*'.repeat(6)  + v.slice(-3)
  if (type === 'hk')    return v.slice(0, 1) + '*'.repeat(7)  + v.slice(-2)
  if (type === 'tw')    return v.slice(0, 1) + '*'.repeat(9)
  if (type === 'macau') return v.slice(0, 1) + '*'.repeat(6)
  return v.length >= 7 ? v.slice(0, 3) + '*'.repeat(v.length - 7) + v.slice(-4) : v
}

export function maskEmail(v) {
  const at = v.lastIndexOf('@')
  if (at < 0) return v
  const l = v.slice(0, at), d = v.slice(at + 1)
  if (l.length <= 2) return l[0] + '*@' + d
  return l[0] + '*'.repeat(Math.min(l.length - 2, 8)) + l.slice(-1) + '@' + d
}

export function maskBank(v) {
  if (/^\d+$/.test(v)) return v.length >= 8 ? v.slice(0, 4) + '*'.repeat(v.length - 8) + v.slice(-4) : v
  const d = v.replace(/\D/g, '')
  if (d.length >= 16) return v.slice(0, 4) + '*'.repeat(v.length - 8) + v.slice(-4)
  return v.length >= 8 ? v.slice(0, 4) + '*'.repeat(v.length - 8) + v.slice(-4) : v
}

export function maskTax(v) {
  return v.length >= 4 ? v.slice(0, 2) + '*'.repeat(v.length - 4) + v.slice(-2) : v
}

export function maskName(ctx, v) {
  if (!ctx.nameMap.has(v)) ctx.nameMap.set(v, '用户_' + sha8(v).slice(0, 4))
  return ctx.nameMap.get(v)
}

export function maskCompany(ctx, v) {
  if (!ctx.companyMap.has(v)) ctx.companyMap.set(v, '公司_' + sha8(v).slice(0, 4))
  return ctx.companyMap.get(v)
}

export function maskVendor(ctx, v) {
  if (!ctx.vendorMap.has(v)) {
    const i = ctx.vendorMap.size + 1
    ctx.vendorMap.set(v, '供应商_' + (i <= 26 ? String.fromCharCode(64 + i) : i))
  }
  return ctx.vendorMap.get(v)
}

export function maskDept(ctx, v) {
  if (!ctx.deptMap.has(v)) {
    const i = ctx.deptMap.size + 1
    ctx.deptMap.set(v, '部门_' + (i <= 26 ? String.fromCharCode(64 + i) : i))
  }
  return ctx.deptMap.get(v)
}

export function maskProject(ctx, v) {
  if (!ctx.projectMap.has(v)) ctx.projectMap.set(v, '项目_' + sha8(v).slice(0, 6))
  return ctx.projectMap.get(v)
}

export function maskAddress(v) {
  const m = v.match(/^([\u4e00-\u9fa5]{2,4}(?:省|市|自治区|特别行政区))?([\u4e00-\u9fa5]{2,10}(?:市|区|县|州|旗))?(.*)/)
  if (!m) return v.slice(0, 4) + '*'.repeat(Math.max(0, v.length - 4))
  const p = m[1] || '', c = m[2] || '', r = m[3] || ''
  const pre = p + c
  if (!r.trim()) return v
  return pre + r.trim().slice(0, 20).replace(/[\u4e00-\u9fa5\w]/g, '*')
}

export function maskAmount(ctx, v) {
  if (typeof v !== 'string') v = String(v ?? '')
  const n = parseFloat(v.replace(/[,，¥￥$€£₩]/g, ''))
  if (isNaN(n)) return v
  return String(Math.round(n * ctx.amountScale * 100) / 100)
}

export function maskRatio(v) {
  if (typeof v !== 'string') v = String(v ?? '')
  return v.replace(/(\d+)(\.\d+)?(%?)/, (_, i, d, p) => i + (d ? '.**' : '') + p)
}

/**
 * 金融数字放缩脱敏（估值/融资/营收/利润等）
 * 保留数量级单位（亿/万/百万/million/billion），对数值做随机放缩
 */
export function maskFinancialNumber(ctx, v) {
  if (typeof v !== 'string') v = String(v ?? '')
  // 匹配数字部分（含小数）
  return v.replace(/([\d,，]+(?:\.\d+)?)/, (_, num) => {
    const n = parseFloat(num.replace(/[,，]/g, ''))
    if (isNaN(n)) return num
    const scaled = Math.round(n * ctx.amountScale * 100) / 100
    return String(scaled)
  })
}

export function maskContract(v) { return '合同_' + sha8(v).slice(0, 6) }
export function maskOrder(v)    { return '单号_' + sha8(v) }
export function maskInvoice(v)  {
  return v.length > 6 ? v.slice(0, 4) + '*'.repeat(v.length - 6) + v.slice(-2) : '*'.repeat(v.length)
}
export function maskLicensePlate(v) {
  const m = v.match(/^([\u4e00-\u9fa5])([A-HJ-NP-Z])([\u00b7\u30fb·]?[A-HJ-NP-Z0-9]{4,5})/)
  return m ? m[1] + m[2] + '***' + m[3].slice(-1) : v.slice(0, 2) + '****' + v.slice(-1)
}
export function maskSocialCredit(v)  { return maskTax(v) }
export function maskEmployeeId(v)    { return '工号_' + sha8(v).slice(0, 6) }
export function maskBirthDate()      { return '****-**-**' }
export function maskAge()            { return '**岁' }
export function maskLicenseNo(v)     { return v.slice(0, 2) + '*'.repeat(v.length - 4) + v.slice(-2) }
export function maskHousingFund(v)   { return '公积金_' + sha8(v).slice(0, 6) }
export function maskMedicalRecord(v) { return '病历号_' + sha8(v).slice(0, 6) }
export function maskSocialSecurity(v){ return '社保_' + sha8(v).slice(0, 6) }

// ── 文本预处理（normalize）────────────────────────────────────────────────────
/**
 * normalizeText：把"格式噪音"清除，让正则能命中原本因排版问题漏掉的内容
 *
 * 处理内容：
 *   1. 全角数字/字母/符号 → 半角（Ａ→A、１→1、：→:、－→-）
 *   2. 全角空格 → 普通空格
 *   3. 换行符（\r\n / \n / \r）→ 单个空格
 *   4. 连续空白 → 单个空格
 *   5. 首尾空白去除
 *
 * 注意：只用于"二次扫描"，原始文本保持不变，脱敏结果取两次扫描的并集。
 */
export function normalizeText(text) {
  return text
    // 全角 → 半角（数字、大小写字母、常用符号）
    .replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // 全角空格
    .replace(/\u3000/g, ' ')
    // 各种换行 → 空格
    .replace(/\r\n|\r|\n/g, ' ')
    // 连续空白 → 单空格
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── 常见中文姓氏字典（百家姓 + 常见复姓）────────────────────────────────────
// 用于：在"姓名"列上下文中，对单独出现的 2-4 字中文词做姓名脱敏
export const COMMON_SURNAMES = new Set([
  '赵','钱','孙','李','周','吴','郑','王','冯','陈','褚','卫','蒋','沈','韩','杨',
  '朱','秦','尤','许','何','吕','施','张','孔','曹','严','华','金','魏','陶','姜',
  '戚','谢','邹','喻','柏','水','窦','章','云','苏','潘','葛','奚','范','彭','郎',
  '鲁','韦','昌','马','苗','凤','花','方','俞','任','袁','柳','酆','鲍','史','唐',
  '费','廉','岑','薛','雷','贺','倪','汤','滕','殷','罗','毕','郝','邬','安','常',
  '乐','于','时','傅','皮','卞','齐','康','伍','余','元','卜','顾','孟','平','黄',
  '和','穆','萧','尹','姚','邵','湛','汪','祁','毛','禹','狄','米','贝','明','臧',
  '计','伏','成','戴','谈','宋','茅','庞','熊','纪','舒','屈','项','祝','董','梁',
  // 常见复姓
  '欧阳','太史','端木','上官','司马','东方','独孤','南宫','万俟','闻人',
  '夏侯','诸葛','尉迟','公羊','赫连','澹台','皇甫','宗政','濮阳','公冶',
  '太叔','申屠','公孙','慕容','仲孙','钟离','长孙','宇文','司徒','鲜于',
])

// ── 机构后缀扩展字典（无"有限公司"等正式后缀的机构名）────────────────────
// 用于：在融资/投资上下文中识别没有正式后缀的机构名
export const INSTITUTION_SUFFIXES = new Set([
  // 投资机构
  '资本','创投','风投','基金','投资','资管','资产','控股','集团','产业',
  'Capital','Ventures','Partners','Fund','Equity','Investment','Holdings',
  'VC','PE','LP','GP',
  // 互联网/科技公司常见简称后缀
  '科技','网络','数据','云','智能','信息','传媒','文化','教育','医疗',
  // 金融机构
  '证券','银行','保险','信托','期货','基金管理',
])

// ── CSV 检测 ──────────────────────────────────────────────────────────────────

export function looksLikeCsv(text) {
  const lines = text.split('\n').map(l => l.trimEnd()).filter(Boolean)
  if (lines.length < 2) return false
  const counts = lines.slice(0, 5).map(l => (l.match(/,/g) || []).length)
  if (counts[0] === 0) return false
  // 所有采样行的列数必须完全一致（允许末尾空行差 0）
  const base = counts[0]
  if (!counts.every(c => c === base)) return false
  return /[a-zA-Z\u4e00-\u9fa5]/.test(lines[0])
}

// ── CSV 列名规则表（供 FileFormat 插件复用）──────────────────────────────────

export const CSV_COLUMN_RULES = [
  { keys: ['phone','mobile','tel','cellphone','手机','电话','联系方式','联系电话','移动电话'],
    fn: (ctx, v) => { hit(ctx, '手机号'); return maskPhone(v) } },
  { keys: ['email','mail','邮箱','邮件','电子邮箱'],
    fn: (ctx, v) => { hit(ctx, '邮箱'); return maskEmail(v) } },
  { keys: ['name','realname','username','fullname','nickname','displayname',
           '姓名','名字','用户名','联系人','负责人','收件人','发件人','当事人','客户姓名','乘客姓名'],
    fn: (ctx, v) => { hit(ctx, '姓名'); return maskName(ctx, v) } },
  { keys: ['idcard','id_card','identity','identitycard','身份证','证件号','证件号码','身份证号'],
    fn: (ctx, v) => { hit(ctx, '身份证号'); return maskIdCard(v) } },
  { keys: ['bankcard','bank_card','cardno','card_no','accountno','银行卡','卡号','银行账号','账户','账号'],
    fn: (ctx, v) => { hit(ctx, '银行卡号'); return maskBank(v) } },
  { keys: ['address','addr','street','location','地址','住址','收货地址','详细地址','通讯地址','户籍地址','家庭住址'],
    fn: (ctx, v) => { hit(ctx, '地址'); return maskAddress(v) } },
  { keys: ['company','organization','org','corp','公司','企业','企业名称','集团','集团名称','基金','基金名称','雇主','工作单位'],
    fn: (ctx, v) => { hit(ctx, '企业/集团/基金名称'); return maskCompany(ctx, v) } },
  { keys: ['vendor','supplier','customer','client','merchant','partner','供应商','客户','甲方','乙方','合作方','经销商','代理商','采购方','销售方'],
    fn: (ctx, v) => { hit(ctx, '供应商/客户'); return maskVendor(ctx, v) } },
  { keys: ['department','dept','division','team','businessunit','部门','事业部','业务线','团队','成本中心','科室','分支机构'],
    fn: (ctx, v) => { hit(ctx, '部门'); return maskDept(ctx, v) } },
  { keys: ['amount','price','salary','revenue','profit','income','expense','cost','budget','fee','total','balance','payment',
           '金额','价格','薪资','收入','支出','利润','营收','成本','费用','总价','余额','实付','应收',
           '估值','融资','融资额','投资额','市值','营业额'],
    fn: (ctx, v) => { hit(ctx, '金额'); return maskAmount(ctx, v) } },
  { keys: ['uid','userid','user_id','openid','empid','employeeid','用户ID','员工号','工号','会员ID'],
    fn: (ctx, v) => { hit(ctx, '用户ID'); return 'uid_' + sha8(v) } },
  { keys: ['ip','ipaddress','ip_address','clientip','remoteip','IP地址','服务器IP','服务器地址'],
    fn: (ctx, v) => { hit(ctx, 'IP地址'); const p = v.split('.'); return p.length === 4 ? p[0] + '.' + p[1] + '.*.*' : v } },
  { keys: ['birth','birthday','birthdate','dob','出生日期','生日','出生年月','出生地'],
    fn: (ctx, v) => { hit(ctx, '出生日期'); return maskBirthDate(v) } },
  { keys: ['age','年龄','岁'],
    fn: (ctx, v) => { hit(ctx, '年龄'); return maskAge(v) } },
  { keys: ['plate','license_plate','car_plate','车牌','车牌号','车辆牌照'],
    fn: (ctx, v) => { hit(ctx, '车牌号'); return maskLicensePlate(v) } },
  { keys: ['contract','contract_no','contract_id','合同','合同号','合同编号'],
    fn: (ctx, v) => { hit(ctx, '合同编号'); return maskContract(v) } },
  { keys: ['order','order_id','orderno','订单','订单号','订单编号','流水号','交易号'],
    fn: (ctx, v) => { hit(ctx, '订单/流水号'); return maskOrder(v) } },
  { keys: ['invoice','invoice_no','invoice_id','发票','发票号','发票代码'],
    fn: (ctx, v) => { hit(ctx, '发票号码'); return maskInvoice(v) } },
  { keys: ['tax','tax_id','credit_code','统一社会信用代码','税号','信用代码','营业执照号'],
    fn: (ctx, v) => { hit(ctx, '统一社会信用代码'); return maskSocialCredit(v) } },
  { keys: ['social','social_security','housing_fund','公积金','社保','社保号','社保账号'],
    fn: (ctx, v) => { hit(ctx, '社保/公积金号'); return maskHousingFund(v) } },
  { keys: ['medical','medical_record','record_no','病历','病历号','就诊号','住院号'],
    fn: (ctx, v) => { hit(ctx, '病历号'); return maskMedicalRecord(v) } },
  { keys: ['wechat','wechat_id','wxid','wx_id','微信','微信号','微信公众号'],
    fn: (ctx, v) => { hit(ctx, '微信/QQ号'); return v.length > 6 ? v.slice(0, 2) + '****' + v.slice(-2) : '****' } },
  { keys: ['qq','qq_id','qq号','qqnumber'],
    fn: (ctx, v) => { hit(ctx, '微信/QQ号'); return v.length > 6 ? v.slice(0, 2) + '****' + v.slice(-2) : '****' } },
]

// ── 列名归一化 ────────────────────────────────────────────────────────────────

export function normalizeColName(n) { return n.toLowerCase().replace(/[\s_\-\u3000\uff01-\uff5e]/g, '') }

/**
 * 列名同义词扩展表
 * key = 归一化后的列名片段，value = 映射到哪条规则的第一个 key（用于查找）
 * 覆盖场景：列名语义正确但用词不在 CSV_COLUMN_RULES.keys 里
 */
const COL_SYNONYMS = {
  // 手机号（只保留明确指向手机的词，避免"联系"、"移动"等通用词误命中）
  '手机号码': 'phone', '电话号码': 'phone', '联系号码': 'phone', '联系电话': 'phone',
  'phonenumber': 'phone', 'cellno': 'phone', 'contactphone': 'phone',
  // 姓名（只保留明确指向人名的词）
  '真实姓名': 'name', '用户姓名': 'name', '客户名称': 'name', '乘客名': 'name',
  '旅客姓名': 'name', '投保人': 'name', '被保险人': 'name', '受益人': 'name',
  '操作员': 'name', '创建者': 'name', '提交者': 'name', '审核人': 'name',
  '经办人': 'name', '负责人': 'name', 'personname': 'name', 'contactname': 'name',
  // 身份证
  '证件号': 'idcard', '证件号码': 'idcard', '身份证号': 'idcard', 'id号码': 'idcard',
  // 地址（只保留明确地址词）
  '居住地址': 'address', '所在地址': 'address', '收件地址': 'address',
  '发件地址': 'address', '注册地址': 'address', '办公地址': 'address',
  // 公司（移除"单位"——太通用，会误命中"单位:箱"等）
  '所在单位': 'company', '工作单位': 'company', '雇主名称': 'company',
  '机构名称': 'company', '品牌方': 'company', '所属公司': 'company',
  // 金额（只保留明确薪资/财务词）
  '薪酬': 'amount', '工资': 'amount', '月薪': 'amount', '年薪': 'amount',
  '奖金': 'amount', '报酬': 'amount', '报销金额': 'amount', '实发金额': 'amount',
  '应发金额': 'amount', '税前工资': 'amount', '税后工资': 'amount', '到手工资': 'amount',
  '营业额': 'amount', '交易额': 'amount', 'gmv': 'amount', 'arr': 'amount',
  // 银行卡（移除"卡"——太短，会误命中"卡通"等）
  '开户账号': 'bankcard', '银行账号': 'bankcard', '账户号码': 'bankcard',
  '银行卡号': 'bankcard', '开户行账号': 'bankcard',
  // 出生日期
  '出生日期': 'birth', '出生年月': 'birth', '出生年月日': 'birth',
  // 部门
  '所属部门': 'department', '归属部门': 'department', '所在部门': 'department',
  '所属事业部': 'department', '所属业务线': 'department',
  // 供应商/客户（移除"合作"、"销售"等通用词）
  '甲方名称': 'vendor', '乙方名称': 'vendor', '合作方名称': 'vendor',
  '采购方': 'vendor', '供应商名称': 'vendor', '客户名称': 'vendor',
}

export function findColRule(colName) {
  const norm = normalizeColName(colName)

  // 1. 精确匹配：列名包含规则 key
  for (const rule of CSV_COLUMN_RULES) {
    if (rule.keys.some(k => norm.includes(normalizeColName(k)))) return rule
  }

  // 2. 同义词扩展匹配
  for (const [synonym, targetKey] of Object.entries(COL_SYNONYMS)) {
    if (norm.includes(normalizeColName(synonym))) {
      const rule = CSV_COLUMN_RULES.find(r => r.keys[0] === targetKey)
      if (rule) return rule
    }
  }

  // 3. 宽松包含匹配：列名里含有规则 key（长度 >= 3），且列名本身也 >= 3 字
  //    只做正向匹配（norm.includes(nk)），避免"单位"反向命中"工作单位"
  if (norm.length >= 3) {
    for (const rule of CSV_COLUMN_RULES) {
      if (rule.keys.some(k => {
        const nk = normalizeColName(k)
        return nk.length >= 3 && norm.includes(nk)
      })) return rule
    }
  }

  return null
}

// ── CSV 行解析 ────────────────────────────────────────────────────────────────

export function parseCsvLine(line) {
  const fields = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else {
      if (ch === '"') inQ = true
      else if (ch === ',') { fields.push(cur); cur = '' }
      else cur += ch
    }
  }
  fields.push(cur)
  return fields
}

export function toCsvField(v) {
  if (v.includes(',') || v.includes('"') || v.includes('\n'))
    return '"' + v.replace(/"/g, '""') + '"'
  return v
}

// ── CSV 文本脱敏（列名精准模式 + 上下文窗口 + 姓氏兜底）────────────────────

/**
 * 上下文列名窗口：当某列规则为 null 时，检查相邻列名是否能提供语义线索
 *
 * 策略：
 *   - 若左侧列名命中"姓名"类规则，且当前值是 2-4 字中文 + 首字是常见姓氏 → 按姓名处理
 *   - 若左侧列名命中"手机"类规则，且当前值看起来像数字串 → 按手机处理
 *   - 若右侧列名命中某规则，且当前值非空 → 用该规则处理（右侧列名往往是"备注/说明"）
 *
 * 这解决了"姓名备注"、"联系方式2"、"手机号（备用）"等列名变体问题。
 */
function inferRuleFromContext(headers, rules, ci, val) {
  const v = val.trim()
  if (!v) return null

  // 向左看一列
  if (ci > 0 && rules[ci - 1]) {
    const leftRule = rules[ci - 1]
    const leftKey = leftRule.keys[0]
    // 左列是姓名类 → 当前值是中文 2-4 字且首字是常见姓氏
    if (leftKey === 'name' && /^[\u4e00-\u9fa5]{2,4}$/.test(v)) {
      const firstChar = v.slice(0, 1)
      const firstTwo  = v.slice(0, 2)
      if (COMMON_SURNAMES.has(firstChar) || COMMON_SURNAMES.has(firstTwo)) return leftRule
    }
    // 左列是手机类 → 当前值是纯数字或带分隔符的数字串
    if (leftKey === 'phone' && /^[\d\s\-\.\/\+]{7,15}$/.test(v)) return leftRule
  }

  // 向右看一列
  if (ci < headers.length - 1 && rules[ci + 1]) {
    const rightRule = rules[ci + 1]
    // 右列有规则，且当前列名含"备注/说明/其他/2/二/副"等补充性词汇
    const h = normalizeColName(headers[ci] || '')
    if (/备注|说明|其他|补充|second|backup|alt|2|二|副/.test(h)) return rightRule
  }

  return null
}

/**
 * 姓氏兜底：在没有任何列名规则的情况下，对 2-4 字中文值做姓名检测
 * 仅在整行有其他列已命中敏感规则时才启用（避免误伤普通文本）
 */
function maybeMaskNameByDict(ctx, val) {
  const v = val.trim()
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(v)) return null
  const firstChar = v.slice(0, 1)
  const firstTwo  = v.slice(0, 2)
  if (COMMON_SURNAMES.has(firstChar) || COMMON_SURNAMES.has(firstTwo)) {
    hit(ctx, '姓名[姓氏推断]')
    return maskName(ctx, v)
  }
  return null
}

function desensitizeCsv(text, ctx) {
  const lines = text.split('\n')
  const nonEmpty = lines.filter(l => l.trimEnd())
  if (nonEmpty.length < 2) return text
  const headerIdx = lines.findIndex(l => l.trimEnd())
  const headers = parseCsvLine(lines[headerIdx])
  const rules = headers.map(h => findColRule(h.trim()))
  if (rules.every(r => r === null)) return null

  const resultLines = lines.map((line, idx) => {
    if (idx === headerIdx) return line
    if (!line.trimEnd()) return line
    const fields = parseCsvLine(line)

    // 先统计本行有多少列已命中规则（用于姓氏兜底的触发条件）
    const hitCount = fields.filter((v, ci) => rules[ci] && v.trim()).length

    const masked = fields.map((val, ci) => {
      if (!val.trim()) return val
      let rule = rules[ci]

      // 列名规则未命中 → 尝试上下文窗口推断
      if (!rule) rule = inferRuleFromContext(headers, rules, ci, val)

      // 仍未命中 + 本行已有其他敏感列 → 尝试姓氏字典兜底
      if (!rule && hitCount > 0) {
        const nameResult = maybeMaskNameByDict(ctx, val)
        if (nameResult !== null) return toCsvField(nameResult)
      }

      if (!rule) return val
      try { return toCsvField(rule.fn(ctx, val.trim())) } catch { return val }
    })
    return masked.join(',')
  })
  return resultLines.join('\n')
}

// ── 正则规则脱敏（兜底层）────────────────────────────────────────────────────

/**
 * 分隔符容忍模式：在数字之间允许出现 0-1 个分隔符（空格/全角空格/-/./\//\）
 * 用于手机号、身份证、银行卡等场景
 */
const SEP = '[\\s\\u3000\\-\\.\\\\/ ]?'  // 单个可选分隔符

function applyRegexRules(text, ctx) {
  // Token / 密码 / 密钥
  text = text.replace(
    /(?:token|access_?token|refresh_?token|api_?key|api_?secret|secret_?key|sk-|sk_|bearer|password|passwd|pwd|auth_?token|session_?id)[=＝\s:]+["']?([a-zA-Z0-9_\-\.]{6,128})["']?/gi,
    (m, v) => {
      hit(ctx, 'Token/密码/密钥')
      const p = m.match(/^[^(=＝\s:)]+/)[0]
      return p + (v.length > 8 ? v.slice(0, 3) + '****' + v.slice(-3) : '********')
    }
  )

  // 邮箱
  text = text.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, m => {
    hit(ctx, '邮箱'); return maskEmail(m)
  })

  // ── 手机号（宽松匹配：支持分隔符/换行/空格变体）──────────────────────────
  // 标准11位：1[3-9]XXXXXXXXX，允许每3-4位之间有一个分隔符
  // 例：138-1234-5678 / 138 1234 5678 / 138.1234.5678 / 138/1234/5678
  text = text.replace(
    /(?<!\d)(?:\+?86[\s\u3000\-]?)?1[3-9]\d[\s\u3000\-\.\/\\]?\d{4}[\s\u3000\-\.\/\\]?\d{4}(?!\d)/g,
    m => { hit(ctx, '手机号'); return maskPhone(m) }
  )
  // 座机：0XX-XXXXXXXX 或 0XXX-XXXXXXX
  // 要求区号与号码之间必须有明确分隔符（- 或空格），避免误伤小数/邮编+数字
  text = text.replace(
    /(?<!\d)0\d{2,3}[\-\s]\d{7,8}(?!\d)/g,
    m => { hit(ctx, '座机号码'); return maskPhone(m) }
  )

  // ── 身份证（宽松匹配：允许每段之间有分隔符）──────────────────────────────
  // 18位：6位地区码 + 8位生日 + 3位顺序码 + 1位校验码
  // 允许格式：XXXXXX XXXXXXXX XXX X 或 XXXXXX-XXXXXXXX-XXX-X 等
  text = text.replace(
    new RegExp(
      '(?<!\\d)' +
      '\\d{6}' + SEP +
      '(?:19|20)\\d{2}' + SEP +
      '(?:0[1-9]|1[0-2])' + SEP +
      '(?:0[1-9]|[12]\\d|3[01])' + SEP +
      '\\d{3}' + SEP +
      '[\\dXx]' +
      '(?!\\d)',
      'g'
    ),
    m => { hit(ctx, '身份证号'); return maskIdCard(stripSep(m), 'cnic') }
  )
  // 15位旧身份证
  text = text.replace(
    new RegExp(
      '(?<!\\d)' +
      '\\d{6}' + SEP +
      '(?:19|20)\\d{2}' + SEP +
      '(?:0[1-9]|1[0-2])' + SEP +
      '(?:0[1-9]|[12]\\d|3[01])' + SEP +
      '\\d{3}' +
      '(?!\\d)',
      'g'
    ),
    m => { hit(ctx, '身份证号'); return maskIdCard(stripSep(m), 'hic') }
  )

  // 港澳台证件
  text = text.replace(/(?<![A-Za-z])[A-Z]\d{6}\([\dA]\)(?![A-Za-z0-9])/g,
    m => { hit(ctx, '港澳通行证/身份证'); return maskIdCard(m, 'hk') })
  text = text.replace(/(?<![A-Za-z])[A-Z]\d{9}(?![A-Za-z0-9])/g,
    m => { hit(ctx, '台湾身份证'); return maskIdCard(m, 'tw') })
  text = text.replace(/(?<!\d)[1-6]\d{6}\([\d]\)(?!\d)/g,
    m => { hit(ctx, '澳门身份证'); return maskIdCard(m, 'macau') })

  // 护照（需要明确上下文关键词，避免误伤产品型号/编号等）
  text = text.replace(
    /(?:护照号?|passport(?:_?no)?)[：:\s]*([EeGgDdSsPp]\d{8})/gi,
    (m, v) => { hit(ctx, '护照号'); return m.replace(v, v[0] + '****' + v.slice(-3)) }
  )

  // 港澳台通行证（需要明确上下文关键词）
  text = text.replace(
    /(?:港澳通行证|台湾通行证|回乡证|通行证号?)[：:\s]*([HhMm]\d{10})/gi,
    (m, v) => { hit(ctx, '港澳台通行证'); return m.replace(v, v.slice(0, 2) + '****' + v.slice(-4)) }
  )

  // 驾驶证（需要明确上下文关键词，避免误伤12位时间戳/金额等）
  text = text.replace(
    /(?:驾驶证号?|驾照号?|driver_?license|dl_?no)[：:\s]*([1-9]\d{11})/gi,
    (m, v) => { hit(ctx, '驾驶证号'); return m.replace(v, maskLicenseNo(v)) }
  )

  // 社保卡（需要明确上下文关键词，避免误伤长数字串）
  text = text.replace(
    /(?:社保卡?号?|社会保障号?|social_?security)[：:\s]*([1-9]\d{16,17})/gi,
    (m, v) => { hit(ctx, '社保卡号'); return m.replace(v, maskSocialSecurity(v)) }
  )

  // 公积金（保留分组格式匹配，特征足够明确）
  text = text.replace(/(?<!\d)\d{10}(?:[\- ]\d{4,6})+(?!\d)/g,
    m => { hit(ctx, '公积金账号'); return maskHousingFund(m) })

  // 统一社会信用代码（需要明确上下文关键词，避免误伤哈希值/UUID/版本号等）
  text = text.replace(
    /(?:统一社会信用代码|信用代码|营业执照号?|tax_?id|credit_?code)[：:\s]*([0-9A-HJ-NP-RT-Y]{18})/gi,
    (m, v) => { hit(ctx, '统一社会信用代码'); return m.replace(v, maskTax(v)) }
  )

  // ── 银行卡（宽松匹配：支持空格/连字符分组，Luhn 校验）──────────────────
  // 常见格式：6222 0000 0000 0000 / 6222-0000-0000-0000
  text = text.replace(
    /(?<!\d)\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4,7}(?!\d)/g,
    m => {
      const d = m.replace(/[\s\-]/g, '')
      if (d.length < 16 || d.length > 19) return m
      const s = d.split('').reverse().reduce((a, x, i) => {
        let n = parseInt(x)
        if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
        return a + n
      }, 0)
      if (s > 0 && s % 10 === 0) { hit(ctx, '银行卡号'); return maskBank(d) }
      return m
    }
  )
  // 纯数字银行卡（无分隔符，16-19位，Luhn 校验）
  text = text.replace(/(?<!\d)\d{16,19}(?!\d)/g, m => {
    const d = m.replace(/\D/g, '')
    const s = d.split('').reverse().reduce((a, x, i) => {
      let n = parseInt(x)
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
      return a + n
    }, 0)
    if (s > 0 && s % 10 === 0) { hit(ctx, '银行卡号'); return maskBank(m) }
    return m
  })

  // IPv4 / IPv6
  // 收紧：排除版本号格式（如 1.2.3.4 / 0.9.1.0 这类四段都 <= 9 的小数字）
  // 真实 IP 通常至少有一段 >= 10（私网：10.x/172.x/192.x，回环：127.x）
  text = text.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (m, a, b, c, d) => {
    const parts = [+a, +b, +c, +d]
    if (!parts.every(o => o <= 255)) return m
    // 四段都 <= 9 视为版本号，不脱敏
    if (parts.every(o => o <= 9)) return m
    hit(ctx, 'IP地址'); return parts[0] + '.' + parts[1] + '.*.*'
  })
  text = text.replace(/(?<![:\w])(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}(?![:\w])/g,
    m => { hit(ctx, 'IPv6地址'); return '****:****:****:****' })

  // KV 对
  const KV_PAIRS = [
    [/(?:phone|mobile|tel|cell)[=：][+\d\- ]{7,15}/gi,
      v => { hit(ctx, '[kv]手机号'); return v.replace(/=.+/, '=****') }],
    [/(?:idcard|id_card|identity|cnic)[=：]\d{17}[\dXx]/gi,
      v => { hit(ctx, '[kv]身份证号'); return v.replace(/=.+/, '=****') }],
    [/(?:email|mail)[=：][a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi,
      v => { hit(ctx, '[kv]邮箱'); return v.replace(/=.+/, '=****') }],
    [/(?:name|realname|username)[=：][\u4e00-\u9fa5A-Za-z0-9_\-]{2,20}/gi,
      v => { hit(ctx, '[kv]姓名'); return v.replace(/=(.+)/, (_, x) => '=' + maskName(ctx, x)) }],
    [/(?:uid|user_?id|openid|empid)[=：][A-Za-z0-9_\-]{4,32}/gi,
      v => { hit(ctx, '[kv]用户ID'); return v.replace(/=(.+)/, (_, x) => '=uid_' + sha8(x)) }],
    [/(?:bankcard|bank_card|card_?no|account)[=：]\d{16,19}/gi,
      v => { hit(ctx, '[kv]银行卡号'); return v.replace(/=(.+)/, (_, x) => '=' + maskBank(x)) }],
    [/(?:address|addr)[=：][\u4e00-\u9fa5A-Za-z0-9\-#,\s]{5,50}/gi,
      v => { hit(ctx, '[kv]地址'); return v.replace(/=(.+)/, (_, x) => '=' + maskAddress(x)) }],
    [/(?:company|corp|org)[=：][\u4e00-\u9fa5A-Za-z0-9·\-]{2,20}/gi,
      v => { hit(ctx, '[kv]企业/集团/基金名称'); return v.replace(/=(.+)/, (_, x) => '=' + maskCompany(ctx, x)) }],
    [/(?:salary|amount|price|income|revenue|profit|valuation|funding)[=：][\d,]+(?:\.\d{1,2})?/gi,
      v => { hit(ctx, '[kv]金额'); return v.replace(/=(.+)/, (_, x) => '=' + maskAmount(ctx, x)) }],
    [/(?:token|api_?key|api_?secret|secret|pwd)[=：][a-zA-Z0-9_\-\.]{6,}/gi,
      v => { hit(ctx, '[kv]Token/密钥'); return v.replace(/=.+/, '=****') }],
    [/(?:ip_?addr|client_?ip|remote_?ip)[=：]\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/gi,
      v => { hit(ctx, '[kv]IP地址'); return v.replace(/=.+/, '=***.***.*.***') }],
  ]
  for (const [re, fn] of KV_PAIRS) text = text.replace(re, fn)

  // URL 敏感参数
  text = text.replace(
    /([?&](?:phone|mobile|email|uid|user_?id|token|access_?token|id_?card|name|openid|realname|bankcard|card_?no|address|password|auth_?token|refresh_?token|api_?key))=([^&\s"'<>]{1,128})/gi,
    (_, k) => { hit(ctx, 'URL敏感参数'); return k + '=****' }
  )

  // 姓名（中文上下文）
  text = text.replace(
    /(?:姓名|联系人|负责人|经办人|申请人|审批人|收件人|发件人|客户名|用户名|操作人|创建人|提交人|乘客|旅客|当事人|受益人|被保险人|投保人)[：:]\s*([\u4e00-\u9fa5]{2,4})/g,
    (m, v) => { hit(ctx, '姓名'); const sep = m.match(/[：:]/)[0]; return m.slice(0, m.indexOf(sep) + 1) + maskName(ctx, v.trim()) }
  )

  // 微信 / QQ
  text = text.replace(
    /(?:微信号?|微信ID|wechat|wxid|QQ号?|qq)[：:\s]\s*([A-Za-z0-9_\-\.]{4,30})/gi,
    (m, v) => { hit(ctx, '微信/QQ号'); const sep = m.match(/[：:\s]/)[0]; return m.slice(0, m.indexOf(sep) + 1) + (v.length > 6 ? v.slice(0, 2) + '****' + v.slice(-2) : '****') }
  )

  // 供应商 / 客户
  text = text.replace(
    /(?:^|(?<=[\s，,、。；;\n]))(?:供应商|客户|甲方|乙方|合作方|承包商|分包商|经销商|代理商|采购方|销售方)[：:]\s*([\u4e00-\u9fa5A-Za-z0-9·\-]{2,20})/gm,
    (m, v) => { hit(ctx, '供应商/客户'); const sep = m.match(/[：:]/)[0]; return m.slice(0, m.indexOf(sep) + 1) + maskVendor(ctx, v.trim()) }
  )

  // 部门
  text = text.replace(
    /(?:部门|成本中心|事业部|业务线|团队|小组|分部|科室)[：:]\s*([\u4e00-\u9fa5A-Za-z0-9·\-]{2,20})/g,
    (m, v) => { hit(ctx, '部门'); const sep = m.match(/[：:]/)[0]; return m.slice(0, m.indexOf(sep) + 1) + maskDept(ctx, v.trim()) }
  )

  // 项目
  text = text.replace(
    /(?:项目|工程|课题|专项)[：:]\s*([\u4e00-\u9fa5A-Za-z0-9·\-]{2,20})/g,
    (m, v) => { hit(ctx, '项目名称'); const sep = m.match(/[：:]/)[0]; return m.slice(0, m.indexOf(sep) + 1) + maskProject(ctx, v.trim()) }
  )

  // ── 企业 / 集团 / 基金名称（全量打码）────────────────────────────────────
  // 1. 带后缀词的公司名（最强信号，直接匹配）
  const COMPANY_SUFFIXES = '(?:有限公司|股份公司|有限责任公司|集团公司|企业集团|合伙企业|工作室|研究院|基金会|出版社|医院|学校|酒店|商场|超市|农场|养殖场|工厂|矿山|基金管理公司|基金公司|资产管理|投资集团|实业集团|控股公司|科技公司|技术公司|咨询公司|律师事务所|会计师事务所|评估公司|担保公司|租赁公司|融资公司|保理公司|信托公司|证券公司|保险公司|经纪公司|代理公司|进出口公司|电商公司|网络公司|传媒公司|文化公司|旅游公司|建筑公司|工程公司|装修公司|设计公司|农业公司|能源公司|化工公司|机械公司|电子公司|通信公司|软件公司|数据公司|物流公司|供应链公司|贸易公司|外运公司|仓储公司|人力资源|商务咨询|企业咨询|管理咨询|产业发展|产业园区|孵化器|加速器|投资管理|资本管理|私募基金|创业投资|风险投资|股权投资|并购基金|产业基金|政府引导基金)'
  text = text.replace(
    new RegExp('[\\u4e00-\\u9fa5A-Za-z0-9]{2,20}' + COMPANY_SUFFIXES, 'g'),
    m => { hit(ctx, '企业/集团/基金名称'); return maskCompany(ctx, m) }
  )
  // 2. 上下文锚点触发（企业/集团/基金 + 冒号）
  text = text.replace(
    /(?:^|(?<=[\s,、。；;\n]))(?:企业|集团|基金|公司|机构|品牌|品牌方|投资方|被投方|LP|GP)[：:]\s*([\u4e00-\u9fa5A-Za-z0-9·\-]{2,20})/gm,
    (m, v) => { hit(ctx, '企业/集团/基金名称'); const sep = m.match(/[：:]/)[0]; return m.slice(0, m.indexOf(sep) + 1) + maskCompany(ctx, v.trim()) }
  )
  // 3. 融资/投资上下文中的公司名（宽松锚点）
  // 例："XX公司完成A轮融资" / "投资方为XX" / "被投企业：XX"
  text = text.replace(
    /([\u4e00-\u9fa5A-Za-z0-9]{2,15})(?=(?:公司|集团|基金|品牌)?(?:完成|获得|宣布|披露|发布|公告)(?:[\u4e00-\u9fa5A-Za-z0-9亿万千百]+(?:元|美元|港元|欧元|英镑))?(?:融资|投资|上市|挂牌|并购|收购|战略合作))/g,
    (m, v) => { hit(ctx, '企业/集团/基金名称'); return maskCompany(ctx, v) }
  )
  // 4. "投资方/领投/跟投/FA" 后的机构名
  // 支持：投资方为：XX / 投资方：XX / 投资方是XX / 领投方为XX
  text = text.replace(
    /(?:投资方|领投方|跟投方|FA机构|财务顾问|主承销商|联席承销商|保荐机构)(?:[：:]|[为是][：:]?)[\s\u3000]*([\u4e00-\u9fa5A-Za-z0-9·\-]{2,20})/g,
    (m, v) => {
      hit(ctx, '企业/集团/基金名称')
      const idx = m.search(/[\u4e00-\u9fa5A-Za-z0-9·\-]{2,20}$/)
      return m.slice(0, idx) + maskCompany(ctx, v.trim())
    }
  )

  // 地址
  const ADDR_BODY = '([\\u4e00-\\u9fa5A-Za-z0-9\\-#号楼室栋层弄巷路街道镇乡县市区省\\s]{4,50})'
  text = text.replace(
    new RegExp('(?:收货地址|发货地址|详细地址|通讯地址|注册地址|办公地址)[：:]\\s*' + ADDR_BODY, 'g'),
    (m, v) => { hit(ctx, '地址'); const sep = m.match(/[：:]/)[0]; return m.slice(0, m.indexOf(sep) + 1) + maskAddress(v.trim()) }
  )
  text = text.replace(
    new RegExp('(?:^|(?<=[\\s，,、。；;\\n]))(?:住址|地址)[：:]\\s*' + ADDR_BODY, 'gm'),
    (m, v) => { hit(ctx, '地址'); const sep = m.match(/[：:]/)[0]; return m.slice(0, m.indexOf(sep) + 1) + maskAddress(v.trim()) }
  )

  // 出生日期（仅在明确上下文关键词下触发，避免误伤普通日期/时间戳/文件名）
  // 带分隔符格式：出生日期：1990-01-01 / 生日：1990/01/01 / 出生年月：1990.01
  text = text.replace(
    /(?:出生日期|生日|出生年月|出生年月日|dob|birthdate|birthday)[：:\s]*((?:19|20)\d{2}[年\-\/.](0?[1-9]|1[0-2])[月\-\/.](0?[1-9]|[12]\d|3[01])[日]?)/gi,
    (m, v) => { hit(ctx, '出生日期'); return m.replace(v, '****-**-**') }
  )
  // 紧凑格式：出生日期：19901201（仅在明确关键词后）
  text = text.replace(
    /(?:出生日期|生日|出生年月|dob)[：:\s]*((?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))/gi,
    (m, v) => { hit(ctx, '出生日期'); return m.replace(v, '****-**-**') }
  )

  // 年龄
  text = text.replace(
    /(?:年龄|岁)[：:]\s*(\d{1,3})/g,
    (_, k) => { hit(ctx, '年龄'); return k + '：**' }
  )

  // ── 金额（货币符号）──────────────────────────────────────────────────────
  text = text.replace(/([¥￥$€£₩])\s*([\d,]+(?:\.\d{1,2})?)/g, (_, s, num) => {
    hit(ctx, '金额')
    const n = parseFloat(num.replace(/,/g, ''))
    if (isNaN(n)) return _
    return s + Math.round(n * ctx.amountScale * 100) / 100
  })
  text = text.replace(/\b(?:USD|CNY|EUR|GBP|JPY|HKD|RMB)\s*([\d,]+(?:\.\d{1,2})?)/gi, (m, num) => {
    hit(ctx, '金额')
    const n = parseFloat(num.replace(/,/g, ''))
    if (isNaN(n)) return m
    return m.replace(num, String(Math.round(n * ctx.amountScale * 100) / 100))
  })
  text = text.replace(
    /(?:金额|收入|支出|利润|营收|成本|税额|应付|应收|实付|实收|余额|薪资|报销|费用|价格|单价|总价|售价|定价)[：:]\s*([\d,]+(?:\.\d+)?)/g,
    (m, num) => { hit(ctx, '金额'); return m.replace(num, maskAmount(ctx, num)) }
  )

  // ── 金融数字放缩（估值/融资/营收/利润等）────────────────────────────────
  // 支持：X亿/X万/X百万/X million/X billion，以及带单位的融资金额
  // 例："估值50亿" → "估值XX.XX亿"，"融资2000万美元" → "融资XXXX万美元"
  const FINANCIAL_ANCHORS = '(?:估值|融资|融资额|融资规模|投资额|投资规模|市值|总市值|营业额|营收|年营收|季度营收|月营收|净利润|毛利润|利润|净利|毛利|EBITDA|ARR|MRR|GMV|交易额|成交额|流水|总流水|月流水|年流水|营业收入|主营收入|总收入|净收入|收入规模|收入体量|融资进展|本轮融资|上轮估值|投后估值|投前估值|Pre-money|Post-money|pre|post)'
  const FINANCIAL_UNITS = '(?:亿|万亿|千亿|百亿|百万|千万|万|元|美元|港元|欧元|英镑|日元|韩元|million|billion|M|B|K)?'
  const FINANCIAL_CURRENCY = '(?:人民币|美元|港元|欧元|英镑|RMB|USD|HKD|EUR|GBP)?'
  text = text.replace(
    new RegExp(
      '(' + FINANCIAL_ANCHORS + ')' +
      '[\\s\\u3000]*' +
      FINANCIAL_CURRENCY +
      '[\\s\\u3000]*' +
      '([\\d,，]+(?:\\.\\d+)?)' +
      '[\\s\\u3000]*' +
      '(' + FINANCIAL_UNITS + ')',
      'gi'
    ),
    (m, anchor, num, unit) => {
      hit(ctx, '金融数字/估值融资')
      const n = parseFloat(num.replace(/[,，]/g, ''))
      if (isNaN(n)) return m
      const scaled = Math.round(n * ctx.amountScale * 100) / 100
      return anchor + scaled + unit
    }
  )
  // 融资进展描述（如"完成A轮融资，金额X亿"）
  text = text.replace(
    /(?:完成|获得|宣布|披露)([A-Za-z\+\u4e00-\u9fa5]{1,4}轮)?(?:融资|投资)[，,\s]*(?:金额|规模|总额)?[为是约达]?\s*([¥￥$€£₩]?\s*[\d,，]+(?:\.\d+)?\s*(?:亿|万亿|千亿|百亿|百万|千万|万|元|美元|港元|欧元|英镑|million|billion|M|B)?)/g,
    (m, round, amount) => {
      hit(ctx, '金融数字/融资进展')
      const masked = amount.replace(/([\d,，]+(?:\.\d+)?)/, (_, num) => {
        const n = parseFloat(num.replace(/[,，]/g, ''))
        if (isNaN(n)) return num
        return String(Math.round(n * ctx.amountScale * 100) / 100)
      })
      return m.replace(amount, masked)
    }
  )

  // 比率
  text = text.replace(
    /(?:增长率|毛利率|净利率|利润率|折扣率|税率|占比|比率|转化率|完成率|达成率|覆盖率|增速|同比|环比|YoY|QoQ|MoM)[：:]\s*([\d.]+%?)/g,
    (m, num) => { hit(ctx, '比率/增长率'); return m.replace(num, maskRatio(num)) }
  )

  // 合同编号
  text = text.replace(/(?<![A-Za-z0-9])[A-Z]{2,6}-\d{4,8}(?:[-\.]\d{2,8})?(?![A-Za-z0-9])/g,
    m => { hit(ctx, '合同编号'); return maskContract(m) })

  // 订单 / 流水号（需要明确上下文关键词，避免误伤时间戳/文件大小/版本号等）
  text = text.replace(
    /(?:订单号?|流水号?|交易号?|单号|order_?(?:id|no)|transaction_?(?:id|no)|trade_?(?:id|no))[：:\s]*([0-9A-Za-z\-]{8,32})/gi,
    (m, v) => { hit(ctx, '订单/流水号'); return m.replace(v, maskOrder(v)) }
  )

  // 发票号码（需有发票关键词上下文，避免误伤文件名日期戳等纯数字）
  text = text.replace(
    /(?:发票号码?|发票代码|invoice(?:_?no)?)[：:\s]*([0-9]{8,12})/gi,
    (full, m) => { hit(ctx, '发票号码'); return full.replace(m, maskInvoice(m)) }
  )

  // 工号
  text = text.replace(
    /(?:工号|员工号|员工编号)[：:]\s*([A-Za-z0-9\-]{4,20})/gi,
    (m, v) => { hit(ctx, '工号'); return m.replace(v, maskEmployeeId(v)) }
  )

  return text
}

// ── 快速检测模式 ──────────────────────────────────────────────────────────────

const QUICK_PATTERNS = [
  // 手机号（含分隔符变体）
  /(?<!\d)(?:\+?86[\s\-]?)?1[3-9]\d[\s\-\.\/]?\d{4}[\s\-\.\/]?\d{4}(?!\d)/,
  // 身份证（18位，含生日段）
  /\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/,
  // 邮箱
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  // 银行卡（16-19位纯数字 或 分组格式）
  /(?<!\d)\d{16,19}(?!\d)/,
  /\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4}/,
  // IP 地址（至少有一段是两位或三位数字，排除 1.2.3.4 这类全单位数版本号）
  /\b(?:\d{2,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\d{1,3}\.\d{2,3}\.\d{1,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\d{2,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{2,3})\b/,
  // Token/密钥（需要 key=value 格式）
  /(?:token|access_?token|api_?key|secret|password|passwd|pwd)\s*[=＝]\s*\S{6,}/i,
  // URL 敏感参数
  /[?&](?:phone|mobile|email|uid|user_?id|token|id_?card|openid)=/i,
  // 微信/QQ（需要关键词前缀）
  /(?:微信号?|wxid|QQ号?)[：:\s]\s*[A-Za-z0-9_.\-]{4,}/i,
  // 合同编号（字母+数字格式，特征明确）
  /[A-Z]{2,6}-\d{4,8}/,
  // 中文敏感关键词（上下文触发）
  /(?:姓名|手机|身份证|邮箱|地址|银行卡|发票|合同|订单|流水|供应商|客户|金额|收入|支出|利润|营收|成本|薪资|部门|项目|车牌|护照|公司|用户名|联系人|出生日期|生日|年龄|估值|融资|市值|营业额|GMV|ARR|驾驶证|社保|公积金|统一社会信用代码|信用代码|营业执照)/,
  /(?:name|username|company|vendor|supplier|customer|address|salary|revenue|profit|department|valuation|funding|passport|social_security|driver_license)\s*[=:]\s*\S/i,
  // 金融数字（估值/融资/营收等 + 数字 + 单位）
  /(?:估值|融资|营收|利润|市值|GMV|ARR|MRR)[\s\u3000]*[\d,，]+(?:\.\d+)?[\s\u3000]*(?:亿|万|百万|million|billion|M|B)/i,
]

export function mightContainSensitiveData(text) {
  if (looksLikeCsv(text)) return true
  return QUICK_PATTERNS.some(p => p.test(text))
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

/**
 * desensitize(text)
 *
 * 两轮扫描策略：
 *
 *   第一轮：对原始文本直接跑正则（保留原始格式）
 *
 *   第二轮：对 normalizeText(原文) 跑正则
 *     - 全角→半角、换行→空格、压缩空白
 *     - 专门捕获因排版噪音导致第一轮漏掉的内容
 *
 *   取舍规则：
 *     - 若两轮命中数相同 → 用第一轮结果（保留原始格式）
 *     - 若第二轮命中更多 → 用第二轮结果（格式已 normalize，但脱敏更彻底）
 *     - 两轮共享同一个 ctx，保证映射一致性（同一个人名始终映射同一个假名）
 */
export function desensitize(text) {
  const ctx = makeCtx()

  // ── 第一轮：原文扫描 ──────────────────────────────────────────────────────
  let result1
  if (looksLikeCsv(text)) {
    const csvResult = desensitizeCsv(text, ctx)
    result1 = csvResult !== null
      ? applyRegexRules(csvResult, ctx)
      : applyRegexRules(text, ctx)
    // CSV 模式不做二次扫描（列名精准模式已足够）
    return { result: result1, stats: ctx.stats }
  }

  result1 = applyRegexRules(text, ctx)
  const hitCount1 = Object.values(ctx.stats).reduce((a, b) => a + b, 0)

  // ── 第二轮：normalize 后补扫 ──────────────────────────────────────────────
  const normalized = normalizeText(text)
  if (normalized === text) {
    // 文本本身没有全角/换行噪音，无需二次扫描
    return { result: result1, stats: ctx.stats }
  }

  // 用同一个 ctx（共享映射），但先备份 stats
  const statsBackup = { ...ctx.stats }
  ctx.stats = {}
  const result2 = applyRegexRules(normalized, ctx)
  const hitCount2 = Object.values(ctx.stats).reduce((a, b) => a + b, 0)

  if (hitCount2 > hitCount1) {
    // 第二轮命中更多：合并 stats，输出第二轮结果
    for (const [k, v] of Object.entries(statsBackup)) {
      ctx.stats[k] = (ctx.stats[k] ?? 0) + v
    }
    return { result: result2, stats: ctx.stats }
  } else {
    // 第一轮已足够：恢复 stats，输出第一轮结果
    ctx.stats = statsBackup
    return { result: result1, stats: ctx.stats }
  }
}
