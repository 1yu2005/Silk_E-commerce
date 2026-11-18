// 作用：删除未使用来源需填写原因并确认；提交沿用会话隔离、防重入和冲突后重读规则。
import { Button, Modal } from 'antd';
import { inventory, inventoryQueries } from '../services/api';
import { CatalogFeedback } from '../catalog/CatalogFeedback';
import { useInventoryCommand } from './use-inventory-command';
import type { Source } from './model';

export function SourceDeleteDialog({source,onClose,onDeleted,reload}:{
 source:Pick<Source,'id'|'namespace'|'reference'|'version'>;onClose:()=>void;onDeleted:()=>void;reload:()=>void;
}){
 const cmd=useInventoryCommand(()=>{
  void inventoryQueries.sources.invalidate();void inventoryQueries.source.invalidate();
  void inventoryQueries.sourceOptions.invalidate();void inventoryQueries.selectedSource.invalidate();
  onDeleted();
 });
 return <Modal open title="删除来源凭据" onCancel={onClose} closable={!cmd.busy} mask={{closable:!cmd.busy}} keyboard={!cmd.busy} footer={null}>
  <p>确认删除“{source.namespace} / {source.reference}”？</p>
  <p>仅没有库存登记或入账引用的来源可以删除。删除后不可恢复，操作审计会保留。</p>
  <CatalogFeedback {...cmd} reload={reload}/>
  <form className="catalog-form" onSubmit={event=>{
   event.preventDefault();const reason=String(new FormData(event.currentTarget).get('reason')).trim();if(!reason)return;
   void cmd.run(()=>inventory.deleteInventorySource({path:{id:source.id},body:{expectedVersion:source.version,reason}}));
  }}><label>删除原因<textarea name="reason" required maxLength={500} rows={3} placeholder="例如：误建且尚未使用的重复凭据" disabled={cmd.busy||cmd.blocked}/></label>
   <div className="catalog-actions"><Button disabled={cmd.busy} onClick={onClose}>取消</Button><Button htmlType="submit" danger type="primary" loading={cmd.busy} disabled={cmd.blocked}>确认删除凭据</Button></div>
  </form>
 </Modal>;
}
