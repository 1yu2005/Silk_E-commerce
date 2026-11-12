// 作用：用虚构密码测量本机 bcrypt 哈希与验证耗时，仅输出环境和性能结果。
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { BCRYPT_COST, PasswordService } from '../src/auth/password.service.js';

async function main() {
  const service = new PasswordService();
  // 固定虚构输入仅用于性能测量，输出只记录环境和耗时。
  const password = 'BenchmarkDemo#2026';
  await service.hash(password);
  const hashing: number[] = [];
  const verifying: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    const started = performance.now();
    const hash = await service.hash(password);
    hashing.push(performance.now() - started);
    const verificationStarted = performance.now();
    if (!await service.verify(password, hash)) throw new Error('基准校验失败');
    verifying.push(performance.now() - verificationStarted);
  }
  const summarize = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const round = (value: number) => Math.round(value * 100) / 100;
    return { samplesMs: values.map(round), medianMs: round(sorted[2]!), maxMs: round(sorted[4]!) };
  };
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version,
    platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model,
    cost: BCRYPT_COST, warmupHashes: 1, samples: 5, mode: 'sequential',
    hashing: summarize(hashing), verifying: summarize(verifying) }, null, 2));
}

main().catch(() => {
  console.error('密码基准测量失败，未输出输入或哈希');
  process.exitCode = 1;
});
