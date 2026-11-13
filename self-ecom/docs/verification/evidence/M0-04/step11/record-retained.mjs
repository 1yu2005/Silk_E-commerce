// 作用：只读记录本轮仍存在的测试临时目录，证明保留策略实际生效；不读取目录中的配置或图片，不执行删除。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = 'docs/verification/evidence/M0-04/step11'; const target = directory + '/retained-artifacts.json'; assert.ok(!existsSync(target));
const startedAt = Date.parse(JSON.parse(readFileSync(directory + '/unit-attempt1.json', 'utf8')).checkedAt);
const prefixes = ['shop-config-', 'self-ecom-files-unit-', 'self-ecom-files-db-', 'self-ecom-avatar-', 'self-ecom-contract-drift-'];
const paths = readdirSync(tmpdir(), { withFileTypes: true }).filter(entry => entry.isDirectory() && prefixes.some(prefix => entry.name.startsWith(prefix)))
  .map(entry => { const path = join(tmpdir(), entry.name); return { path, createdAt: statSync(path).birthtime.toISOString(), exists: existsSync(path) }; })
  .filter(entry => Date.parse(entry.createdAt) >= startedAt);
for (const prefix of prefixes) assert.ok(paths.some(entry => entry.path.split(/[\\/]/).at(-1).startsWith(prefix)), '本轮临时目录未保留：' + prefix);
const report = { checkedAt: new Date().toISOString(), passed: true, paths, policy: '保留临时目录，后续由用户决定是否手动删除',
  correction: 'Vitest未显示预加载console日志不代表清理已发生；磁盘实查确认首轮目录仍在，另增加显式setupFiles及54项定向复验' };
writeFileSync(target, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ retainedDirectories: paths.length, allFiveCategoriesPresent: true }));
