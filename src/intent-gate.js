/**
 * agent-intent-gate —— 意图 + 交付授权门的最小实现（零依赖）
 *
 * 两个问题：
 *   ① 这一轮该不该动手？        → classifyIntent / isSkillAllowed
 *   ② 这次凭空新建文件该不该放行？ → isDeliveryAuthorized / planAuthGate
 *
 * 核心修复：用户说「把这份诊断报告存成 Word 文件」这类句子，
 * 既没有「帮我/给我」前缀，也没有「动词+量词」，旧判据会判成「只读调查」+「未授权」，
 * 于是文件永远写不出来。判据改成结构：落盘动词 + 文件类名词。
 */
'use strict';

// ===================== 一、四种任务模式 =====================

const MODE = {
  QUESTION: 'QUESTION', // 只要答案：解释、原因、怎么看
  DIAGNOSE: 'DIAGNOSE', // 只读调查：读源码 / 日志 / 数据
  PLAN: 'PLAN',         // 要方案：怎么改、有哪些选择
  EXECUTE: 'EXECUTE',   // 明确让动手：做 / 改 / 存 / 导出 / 部署
};

/** 只有 EXECUTE 被授权「改动环境」。其余三种只允许只读与元工具。 */
const AUTHORIZED_MODES = new Set([MODE.EXECUTE]);

const isExecutionAuthorized = (mode) => AUTHORIZED_MODES.has(mode);

// ===================== 二、技能分级 =====================

/** 只读技能：任何模式下都放行（不改变任何东西）。 */
const READONLY_SKILLS = new Set([
  'file-read', 'file-list', 'file-search', 'doc-read',
  'image-info', 'image-ocr', 'web-fetch', 'calculator',
]);

/** 元工具：只影响对话流程，不碰环境。 */
const META_TOOLS = new Set([
  'workflow_plan', 'request_material', 'clarify_requirements', 'pick_local_files',
]);

/** 会产出新文件的技能（示意，按你的产品补全）。 */
const PRODUCER_SKILLS = new Set([
  'file-write', 'docx-generate', 'pdf-generate', 'ppt-generate',
  'excel-generate', 'chart-generate', 'image-generate',
]);

/**
 * 某个技能在当前模式下是否允许调用。
 * @param {string} skillName
 * @param {string} mode
 * @returns {{allowed:boolean, reason:string}}
 */
function isSkillAllowed(skillName, mode) {
  const name = String(skillName || '');
  if (!name) return { allowed: false, reason: 'empty-name' };
  if (isExecutionAuthorized(mode)) return { allowed: true, reason: 'authorized' };
  if (META_TOOLS.has(name)) return { allowed: true, reason: 'meta-tool' };
  if (READONLY_SKILLS.has(name)) return { allowed: true, reason: 'readonly' };
  return { allowed: false, reason: 'needs-authorization' };
}

// ===================== 三、意图判定 =====================

const NO_EXEC_PATTERNS = [
  /(?:先别|不要|别|不用|无需|不必)(?:去)?(?:动手|改|做|写|执行|部署|动|生成)/,
  /(?:只|先)(?:回答我|告诉我|说说|讲讲)/,
];

const EXEC_PATTERNS = [
  /(?:帮我|给我|替我|麻烦你?|请你?)(?:做|写|生成|改|修|导出|存|保存|整理|建|搭|跑|执行|部署)/,
  /(?:执行|开始做|动手|去做|搞定|改好|修好|完成它)/,
];

/** 真疑问词：出现即说明用户在问原因/方式，而不是在派活。 */
const TRUE_INQUIRY_RE = /(为什么|为何|什么|啥|怎么|如何|怎样|哪里|哪个|哪一|是不是|是否|算不算|对不对|有没|要不要)/;

const DIAGNOSE_PATTERNS = [
  /(查一下|查下|排查|诊断|定位|分析|看一下|看看)/,
  /(为什么|原因|怎么造成|什么导致的)/,
];

const PLAN_PATTERNS = [
  /(方案|建议|思路|计划|怎么改|如何改|选哪个|有什么办法)/,
];

const QUESTION_PATTERNS = [
  /[？?]\s*$/,
  /(吗|呢)\s*[？?]?\s*$/,
  /(什么是|是什么意思|能不能|可不可以|会不会)/,
];

// ---- 核心新增：落成文件的显式指令 ----

const SAVE_VERB_RE = /(?:存成|存为|保存成|保存为|另存为|存到|保存到|写到|写入|写成|导出成|导出为|导出到|输出成|输出为|输出到|整理成|做成|转成)/;
const FILE_KIND_RE = /(?:文件|文档|报告|表格|文案|清单|方案|总结|Word|word|DOCX|docx|PDF|pdf|Excel|excel|XLSX|xlsx|PPT|ppt|PPTX|pptx|TXT|txt|Markdown|markdown|md|图片|照片|截图|\.[a-z0-9]{2,5})/;

/**
 * 「落盘动词 + 文件类名词」= 明确的交付物指令。
 * 相距 ≤ 12 字且不跨句，避免把「把这段整理成什么样」误判成派活。
 */
const ARTIFACT_SAVE_RE = new RegExp(SAVE_VERB_RE.source + '[^。！？?]{0,12}' + FILE_KIND_RE.source);

/**
 * 判定本轮用户意图。
 * @param {string} userText 用户这一轮说的话
 * @returns {{mode:string, reason:string, signals:string[]}}
 */
function classifyIntent(userText) {
  const text = String(userText == null ? '' : userText).trim();
  if (!text) return { mode: MODE.EXECUTE, reason: 'empty-input', signals: [] };

  // ① 否定执行：最强信号，压过一切
  if (NO_EXEC_PATTERNS.some((re) => re.test(text))) {
    const diag = DIAGNOSE_PATTERNS.some((re) => re.test(text));
    return { mode: diag ? MODE.DIAGNOSE : MODE.QUESTION, reason: 'explicit-no-execute', signals: [] };
  }

  // ② 显式执行
  const exec = EXEC_PATTERNS.filter((re) => re.test(text)).map(String);
  if (exec.length) return { mode: MODE.EXECUTE, reason: 'explicit-execute', signals: exec };

  // ②·二 明确的「落成文件」指令（必须在 ③ 诊断之前：
  //      「把这份诊断报告存成 Word 文件」含「诊断」二字，放到后面会被判成只读调查）
  if (!TRUE_INQUIRY_RE.test(text) && ARTIFACT_SAVE_RE.test(text)) {
    return { mode: MODE.EXECUTE, reason: 'artifact-save', signals: [String(ARTIFACT_SAVE_RE)] };
  }

  // ③ 只读调查
  if (DIAGNOSE_PATTERNS.some((re) => re.test(text))) {
    return { mode: MODE.DIAGNOSE, reason: 'diagnose', signals: [] };
  }

  // ④ 求方案
  if (PLAN_PATTERNS.some((re) => re.test(text))) {
    return { mode: MODE.PLAN, reason: 'plan', signals: [] };
  }

  // ⑤ 疑问句
  if (QUESTION_PATTERNS.some((re) => re.test(text))) {
    return { mode: MODE.QUESTION, reason: 'question', signals: [] };
  }

  // ⑥ 兜底：向后兼容（注意：兜底 ≠ 授权，见 isDeliveryAuthorized）
  return { mode: MODE.EXECUTE, reason: 'default-execute', signals: [] };
}

// ===================== 四、交付授权（凭空新建文件） =====================

/** 有**证据**的执行授权档位。`default-execute` 刻意不在内：它表示「什么都没找到」。 */
const DELIVERY_AUTH_REASONS = new Set(['explicit-execute', 'artifact-save']);

/** 「动词+量词」/「动词+一下」：最朴素的派活。 */
const CREATION_QUANTIFIER_RE = /(?:写|生成|制作|做|画|创建|新建|搭建|出|整理|输出)(?:一个|一份|一张|一套|一篇|一版|个|份|张|套|篇|版)/;
const IMPERATIVE_YIXIA_RE = /(?:跑|试|执行|调|改|弄|搞|处理|做|写|生成|画|建|搭|装|部署|上传|打包)(?:一下|下)/;

const AFFIRM_WORDS = new Set([
  '好', '好的', '可以', '可以了', '行', '行吧', '嗯', '对', '是的', '没问题', '同意',
  '做吧', '开始', '开始吧', '干吧', '去吧', '搞吧', '动手', '开工', '继续', '接着来',
  'ok', 'okay',
]);

/** 剥掉标点空白后整句比对（「好，开始吧」⇒「好开始吧」）。 */
function squash(text) {
  return String(text == null ? '' : text)
    .replace(/[\s，,。.!！?？~～、；;："'“”‘’…—-]/g, '')
    .toLowerCase();
}

/** 「可以，但第 3 条改一下」——前半放行、后半追加要求。这类是授权，不能因为带了要求就不认。 */
const AFFIRM_THEN_REQUEST_RE = /^(?:可以|好|行|没问题|同意|嗯)(?:但|不过|只是|另外|同时|顺便|然后)/;

/** 用户是否明确点头（整句级，不做子串匹配——否则「不可以」会命中「可以」）。 */
function isAffirmative(text) {
  const t = squash(text);
  if (!t) return false;
  if (AFFIRM_WORDS.has(t)) return true;
  if (AFFIRM_THEN_REQUEST_RE.test(t)) return true;
  // 两段式：「好开始吧」「可以动手」= 肯定词 + 另一个肯定词。
  for (const w of AFFIRM_WORDS) {
    if (w.length >= t.length) continue;
    if (t.indexOf(w) !== 0) continue;
    if (AFFIRM_WORDS.has(t.slice(w.length))) return true;
  }
  return false;
}

/**
 * 本轮是否给了「可以凭空新建一个文件」的授权。
 * @param {string} userText 只取**本轮**用户原话
 * @returns {{ok:boolean, reason:string}}
 */
function isDeliveryAuthorized(userText) {
  const text = String(userText == null ? '' : userText);
  if (!text.trim()) return { ok: false, reason: 'empty-input' };

  const intent = classifyIntent(text);
  if (DELIVERY_AUTH_REASONS.has(intent.reason)) return { ok: true, reason: intent.reason };
  if (isAffirmative(text)) return { ok: true, reason: 'affirmative' };
  if (CREATION_QUANTIFIER_RE.test(text)) return { ok: true, reason: 'creation-with-quantifier' };
  if (IMPERATIVE_YIXIA_RE.test(text)) return { ok: true, reason: 'imperative-with-yixia' };
  return { ok: false, reason: intent.reason };
}

/**
 * 新建交付物的授权门：只在「产出类技能 + 目标是新建 + 用户没授权 + 本任务还没拦过」时拦截。
 *
 * @param {object} o
 * @param {string} o.skillName
 * @param {boolean} o.pathExists 目标文件是否已存在（覆盖已有文件不归本门管）
 * @param {string} o.userText    本轮用户原话
 * @param {boolean} [o.alreadyBlocked] 本任务内是否已被本门拦过一次
 * @param {boolean} [o.alreadyGranted] 本轮是否已从用户答复/素材拿到授权
 * @param {string} [o.target]
 * @returns {{blocked:boolean, reason:string, target:string, directive:string}}
 */
function planAuthGate(o) {
  const c = o || {};
  const name = String(c.skillName || '');
  const pass = (reason) => ({ blocked: false, reason, target: '', directive: '' });

  if (!PRODUCER_SKILLS.has(name)) return pass('not-producer-skill');
  if (c.pathExists === true) return pass('overwrite-existing');
  if (c.alreadyBlocked === true) return pass('already-blocked-once');
  if (c.alreadyGranted === true) return pass('granted-by-answer');

  const auth = isDeliveryAuthorized(c.userText);
  if (auth.ok) return pass('authorized:' + auth.reason);

  const target = String(c.target == null ? '' : c.target);
  return {
    blocked: true,
    reason: 'no-delivery-auth:' + auth.reason,
    target,
    directive:
      '【没有创建文件】这一轮用户说的是「' + String(c.userText || '').slice(0, 120) + '」，' +
      '既没有动作要求，也没有明确点头。若确实该出一份文件，问**一句**「要我现在整理成文件吗？」然后停下等回复；' +
      '用户回「可以 / 做吧」后下一轮直接做。禁止换个技能名或换个路径重试。',
  };
}

module.exports = {
  MODE,
  AUTHORIZED_MODES,
  READONLY_SKILLS,
  META_TOOLS,
  PRODUCER_SKILLS,
  SAVE_VERB_RE,
  FILE_KIND_RE,
  ARTIFACT_SAVE_RE,
  DELIVERY_AUTH_REASONS,
  isExecutionAuthorized,
  isSkillAllowed,
  classifyIntent,
  isAffirmative,
  isDeliveryAuthorized,
  planAuthGate,
};
