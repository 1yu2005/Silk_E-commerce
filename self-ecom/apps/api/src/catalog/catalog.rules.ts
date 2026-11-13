// 作用：纯规格规则，先校验容量再展开组合；固定身份与显示文字分开。
import { createHash } from 'node:crypto';
import { CatalogError } from './catalog.errors.js';
export const nameKey = (name: string) => name.normalize('NFC').trim().toLowerCase();
export const catalogIcons = ['clothes', 'top', 'trousers', 'coat', 'dress', 'accessory'] as const;
export interface SpecValueInput { id?: string; clientKey?: string; name: string }
export interface SpecInput extends SpecValueInput { values: SpecValueInput[] }
export function validateScheme(dimensions: SpecInput[]) {
  if (dimensions.length > 3 || dimensions.some(d => d.values.length < 1 || d.values.length > 20)
    || dimensions.reduce((n, d) => n * d.values.length, 1) > 200) throw new CatalogError('SKU_COMBINATION_LIMIT');
  const ids = new Set<string>(); const names = new Set<string>();
  for (const d of dimensions) {
    if (names.has(nameKey(d.name))) throw new CatalogError('VALIDATION_FAILED'); names.add(nameKey(d.name));
    const values = new Set<string>();
    for (const item of [d, ...d.values]) {
      if (!!item.id === !!item.clientKey || ids.has(item.id ?? item.clientKey!)) throw new CatalogError('VALIDATION_FAILED');
      ids.add(item.id ?? item.clientKey!);
    }
    for (const v of d.values) { if (values.has(nameKey(v.name))) throw new CatalogError('VALIDATION_FAILED'); values.add(nameKey(v.name)); }
  }
}
export function combinations(dimensions: { id: string; values: { id: string }[] }[]) {
  return dimensions.reduce<{ dimensionId: string; valueId: string }[][]>((rows, d) =>
    rows.flatMap(row => d.values.map(v => [...row, { dimensionId: d.id, valueId: v.id }])) , [[]]);
}
export function signature(choices: { dimensionId: string; valueId: string }[]) {
  return choices.length ? createHash('sha256').update(JSON.stringify([...choices].sort((a,b) => a.dimensionId.localeCompare(b.dimensionId)))).digest('hex') : 'DEFAULT';
}
