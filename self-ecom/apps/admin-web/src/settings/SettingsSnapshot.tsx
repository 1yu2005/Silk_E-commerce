/** 文件作用：只读展示某一历史版本的完整经营配置，不提供历史回滚或覆盖入口。 */
import { centsToYuan, deadlineFields, type SettingsVersion } from './model';

export function SettingsSnapshot({ setting }: { setting: SettingsVersion }) {
  const address = setting.returnAddress;
  return <div className="settings-snapshot">
    <section className="settings-group"><h2>运费规则</h2><dl className="settings-facts">
      <div><dt>基础运费</dt><dd>{centsToYuan(setting.shippingFeeCents)} 元（{setting.shippingFeeCents} 分）</dd></div>
      <div><dt>满额包邮</dt><dd>{setting.freeShippingEnabled ? '开启' : '关闭'}</dd></div>
      <div><dt>包邮门槛</dt><dd>{centsToYuan(setting.freeShippingThresholdCents)} 元（{setting.freeShippingThresholdCents} 分）{!setting.freeShippingEnabled ? '，当前不生效' : ''}</dd></div>
    </dl></section>
    <section className="settings-group"><h2>退货地址</h2><dl className="settings-facts">
      <div><dt>收件人</dt><dd>{address.receiver}</dd></div><div><dt>联系电话</dt><dd>{address.phone}</dd></div>
      <div><dt>地址</dt><dd>{address.province} {address.city} {address.district} {address.detail}</dd></div>
    </dl></section>
    <section className="settings-group"><h2>服务联系</h2><dl className="settings-facts">
      <div><dt>公开服务电话</dt><dd>{setting.serviceContact.phone}</dd></div><div><dt>服务时间</dt><dd>{setting.serviceContact.serviceHours ?? '未填写'}</dd></div>
    </dl></section>
    <section className="settings-group"><h2>处理期限</h2><p className="settings-hint">按北京时间计算。工作日仅为周一至周五，暂不含节假日和调休。</p><dl className="settings-facts">
      {deadlineFields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{setting.deadlines[field.key]} {field.unit}</dd></div>)}
    </dl></section>
  </div>;
}
