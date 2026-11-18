// 作用：草稿删除必须明确确认；复用会话隔离提交与服务端版本/业务引用校验。
import { Button, Modal } from 'antd';
import { catalog, catalogQueries, inventoryQueries } from '../services/api';
import type { Product } from './model';
import { CatalogFeedback } from './CatalogFeedback';
import { useCatalogCommand } from './use-catalog-command';

export function ProductDeleteDialog({ product, onClose, onDeleted, reload }: {
  product: Pick<Product, 'id' | 'name' | 'version'>;
  onClose: () => void;
  onDeleted: () => void;
  reload: () => void;
}) {
  const cmd = useCatalogCommand(() => {
    void catalogQueries.products.invalidate();
    void inventoryQueries.balances.invalidate();
    void inventoryQueries.skuOptions.invalidate();
    onDeleted();
  });
  return <Modal open title="删除商品草稿" onCancel={onClose} closable={!cmd.busy} mask={{closable:!cmd.busy}} keyboard={!cmd.busy} footer={[
    <Button key="cancel" disabled={cmd.busy} onClick={onClose}>取消</Button>,
    <Button key="delete" danger type="primary" loading={cmd.busy} disabled={cmd.blocked} onClick={() => void cmd.run(() => catalog.deleteProductDraft({ path: { id: product.id }, body: { expectedVersion: product.version, reason: '确认删除未使用的商品草稿' } }))}>确认删除草稿</Button>,
  ]}>
    <p>确认删除“{product.name}”？</p>
    <p>仅零库存、没有入库凭据及其他业务引用的未归档草稿可以删除。</p>
    <p>商品资料、规格、图片关联和未入账的初始数量草稿将一并移除，删除后不可恢复。</p>
    <CatalogFeedback {...cmd} reload={reload}/>
  </Modal>;
}
