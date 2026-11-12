#!/usr/bin/env node
/**
 * 用法：
 *   node src/demo.mjs "把这份诊断报告存成 Word 文件"
 *   node src/demo.mjs "为什么存成文件会失败？"
 *
 * 打印这句原话在门里的判定，以及模拟一次「新建 file-write」时会放行还是拦下。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyIntent, isSkillAllowed, isDeliveryAuthorized, planAuthGate,
} = require('./intent-gate.js');

const text = process.argv.slice(2).join(' ') || '把这份诊断报告存成 Word 文件';

const intent = classifyIntent(text);
const skill = isSkillAllowed('file-write', intent.mode);
const auth = isDeliveryAuthorized(text);
const gate = planAuthGate({
  skillName: 'file-write',
  pathExists: false,
  userText: text,
  alreadyBlocked: false,
  target: '诊断报告.docx',
});

const pad = (s, n) => String(s).padEnd(n, ' ');
console.log('');
console.log('输入：' + text);
console.log('─'.repeat(60));
console.log(pad('意图模式', 14) + intent.mode);
console.log(pad('判定理由', 14) + intent.reason);
console.log(pad('动手资格', 14) + (skill.allowed ? '允许（' + skill.reason + '）' : '拒绝（' + skill.reason + '）'));
console.log(pad('交付授权', 14) + (auth.ok ? '有（' + auth.reason + '）' : '无（' + auth.reason + '）'));
console.log(pad('新建文件门', 14) + (gate.blocked ? '拦下（' + gate.reason + '）' : '放行（' + gate.reason + '）'));
console.log('─'.repeat(60));
if (gate.blocked) console.log('门给模型的回灌文案：\n' + gate.directive);
console.log('');
