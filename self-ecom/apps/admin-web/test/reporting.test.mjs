// 图表缩放不能使精确金额丢分；负净额和零数据仍可读取。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {money,decimal,reportDate,trendCoordinates} from '../src/reporting/model.ts';
test('人民币字符串保留大整数/负号/完整分位',()=>{
 assert.equal(money('9007199254740993'),'¥90,071,992,547,409.93');
 assert.equal(money('-9007199254740993'),'-¥90,071,992,547,409.93');
 assert.equal(money('-1'),'-¥0.01');assert.equal(money('0'),'¥0.00');assert.equal(decimal('10000000000000001'),'10,000,000,000,000,001');
});
test('趋势图仅对有界比例转Number，负净额位于零线之下，空值不生成NaN',()=>{
 const items=[{paidAmountCents:'9007199254740993',refundAmountCents:'0',netReceiptsCents:'9007199254740993'},{paidAmountCents:'0',refundAmountCents:'9007199254740993',netReceiptsCents:'-9007199254740993'}];
 const c=trendCoordinates(items),ys=c.series('netReceiptsCents').split(' ').map(p=>Number(p.split(',')[1]));assert.ok(ys[0]<c.zero);assert.ok(ys[1]>c.zero);assert.ok(ys.every(Number.isFinite));
 assert.equal(trendCoordinates([]).series('paidAmountCents'),'');assert.ok(Number.isFinite(trendCoordinates([{paidAmountCents:'0',refundAmountCents:'0',netReceiptsCents:'0'}]).zero));
});
test('面板日期固定北京时间且明确显示读取时点',()=>{assert.match(reportDate('2030-11-14T16:00:00Z'),/2030.*11.*15/);});
