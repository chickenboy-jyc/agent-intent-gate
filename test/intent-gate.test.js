'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODE, classifyIntent, isSkillAllowed, isDeliveryAuthorized, planAuthGate,
} = require('../src/intent-gate.js');

// ===================== 一、修好之前那个死锁的核心用例 =====================

test('「把这份诊断报告存成 Word 文件」必须判成执行，并拿到交付授权', () => {
  const cases = [
    '把这份诊断报告存成 Word 文件',
    '把结果保存为 PDF 文件',
    '把结论写成文件',
    '把结果导出成 Excel',
    '把这段整理成一份报告文档',
  ];
  for (const text of cases) {
    const intent = classifyIntent(text);
    assert.equal(intent.mode, MODE.EXECUTE, text + ' 应判 EXECUTE，实得 ' + intent.mode);
    assert.equal(intent.reason, 'artifact-save', text + ' 的理由应为 artifact-save，实得 ' + intent.reason);
    assert.equal(isDeliveryAuthorized(text).ok, true, text + ' 应获得交付授权');
  }
});

test('问原因不等于让我写：含真疑问词的句子不许被 artifact-save 放行', () => {
  const text = '为什么存成文件会失败？';
  const intent = classifyIntent(text);
  assert.notEqual(intent.mode, MODE.EXECUTE);
  assert.notEqual(intent.reason, 'artifact-save');
  assert.equal(isDeliveryAuthorized(text).ok, false);
});

test('结构判据：只有落盘动词、没有文件类名词时不算派活', () => {
  for (const text of ['把这段整理成什么样', '存成什么样都行']) {
    assert.equal(isDeliveryAuthorized(text).ok, false, text + ' 不该被放行');
  }
});

// ===================== 二、反控：旧判据里那些「不该放行」的句子 =====================

test('补信息 / 纯陈述 / 空输入 不许被放行', () => {
  const mustBlock = [
    '第一个是皇空8 第6个是尼尔机械纪元',
    '第10条是黑神话悟空',
    '我记得好像是极限竞速地平线',
    '',
    '。。。',
  ];
  for (const text of mustBlock) {
    assert.equal(isDeliveryAuthorized(text).ok, false, JSON.stringify(text) + ' 不该被放行');
  }
});

test('明确点头算授权（整句比对，不做子串匹配）', () => {
  assert.equal(isDeliveryAuthorized('做吧').ok, true);
  assert.equal(isDeliveryAuthorized('好，开始吧').ok, true);
  assert.equal(isDeliveryAuthorized('可以，但第 3 条改一下').ok, true); // 带追加要求仍算点头
  assert.equal(isDeliveryAuthorized('不可以').ok, false);              // 反向词不许被读成同意
});

test('动词+量词 仍然能拿到授权（既有契约不能被新判据挤掉）', () => {
  assert.equal(isDeliveryAuthorized('写一个报告文件给我').ok, true);
  assert.equal(isDeliveryAuthorized('生成一份PPT').ok, true);
});

// ===================== 三、意图模式 =====================

test('只读调查与求方案仍然降档', () => {
  assert.equal(classifyIntent('帮我查一下为什么崩溃').mode, MODE.DIAGNOSE);
  assert.equal(classifyIntent('排查一下这个报错').mode, MODE.DIAGNOSE);
  assert.equal(classifyIntent('这个应该怎么改比较好？').mode, MODE.PLAN);
});

test('诊断模式下，写文件技能不放行；只读技能一律放行', () => {
  const mode = classifyIntent('帮我查一下为什么崩溃').mode;
  assert.equal(isSkillAllowed('file-write', mode).allowed, false);
  assert.equal(isSkillAllowed('file-read', mode).allowed, true);
  assert.equal(isSkillAllowed('workflow_plan', mode).allowed, true);
});

// ===================== 四、交付授权门的生命周期 =====================

test('planAuthGate：没授权时拦下新建，并且只拦一次', () => {
  const blockedCase = {
    skillName: 'file-write',
    pathExists: false,
    userText: '第一个是皇空8 第6个是尼尔机械纪元',
    alreadyBlocked: false,
    target: 'x.docx',
  };
  const first = planAuthGate(blockedCase);
  assert.equal(first.blocked, true);
  assert.match(first.reason, /^no-delivery-auth:/);
  assert.equal(first.target, 'x.docx');
  assert.ok(first.directive.includes('没有创建文件'));

  // 拦过一次后放行（否则用户回了「做吧」也过不去，变成反复追问）
  assert.equal(planAuthGate({ ...blockedCase, alreadyBlocked: true }).blocked, false);
  // 覆盖已有文件不归本门管
  assert.equal(planAuthGate({ ...blockedCase, pathExists: true }).blocked, false);
  // 非产出类技能不归本门管
  assert.equal(planAuthGate({ ...blockedCase, skillName: 'file-read' }).blocked, false);
  // 用户答了澄清 / 给了素材（调用方已确认授权）
  assert.equal(planAuthGate({ ...blockedCase, alreadyGranted: true }).blocked, false);
});

test('planAuthGate：用户明确说「存成文件」时直接放行', () => {
  const r = planAuthGate({
    skillName: 'file-write',
    pathExists: false,
    userText: '把这份诊断报告存成 Word 文件',
    alreadyBlocked: false,
    target: '诊断报告.docx',
  });
  assert.equal(r.blocked, false);
  assert.equal(r.reason, 'authorized:artifact-save');
});

test('planAuthGate：对产出类技能的覆盖不是「只认 file-write」', () => {
  const userText = '把结果导出成 PDF 文件';
  for (const skillName of ['file-write', 'docx-generate', 'pdf-generate', 'excel-generate']) {
    const r = planAuthGate({ skillName, pathExists: false, userText, alreadyBlocked: false, target: 't' });
    assert.equal(r.blocked, false, skillName + ' 应放行，实得 ' + r.reason);
  }
});
