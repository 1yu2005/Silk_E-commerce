/** 文件作用：编辑四组完整设置，阻止重复保存、过期版本覆盖及未确认结果重发。 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input } from 'antd';
import { ApiClientError } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
import { session, settings } from '../services/api';
import { deadlineFields, deadlineNumber, phoneIssue, settingsFormValues, settingsInput, textIssue, yuanToCents,
  type CurrentSettings, type SettingsFormValues } from './model';

const rule = (validate: (value: unknown) => string | null) => ({ validator: (_: unknown, value: unknown) => {
  const issue = validate(value); return issue ? Promise.reject(new Error(issue)) : Promise.resolve();
} });
const textRule = (label: string, max: number, optional = false) => rule(value => textIssue(value, label, max, optional));

export function SettingsForm({ current, onSaved, onReload }: {
  current: CurrentSettings; onSaved: (changed: boolean, version: number) => void; onReload: () => void;
}) {
  const [form] = Form.useForm<SettingsFormValues>();
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState<unknown>(null);
  const [blocked, setBlocked] = useState<'conflict' | 'uncertain' | null>(null);
  const mounted = useRef(true); const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(values: SettingsFormValues) {
    if (pending.current || blocked || !session.current().credential) return;
    pending.current = true; setSubmitting(true); setError(null);
    const revision = session.current().revision; const loginRevision = session.getLoginRevision();
    const isCurrent = () => mounted.current && session.current().revision === revision && session.getLoginRevision() === loginRevision;
    try {
      const { data } = await settings.updateStoreSettings({ body: settingsInput(values, current.version) });
      if (isCurrent()) onSaved(data.changed, data.version);
    } catch (failure) {
      if (isCurrent()) {
        setError(failure);
        if (failure instanceof ApiClientError && failure.status === 409) setBlocked('conflict');
        else if (!(failure instanceof ApiClientError) || !failure.status || failure.status >= 500) setBlocked('uncertain');
      }
    } finally { pending.current = false; if (mounted.current) setSubmitting(false); }
  }

  return <>
    {!current.configured ? <Alert className="auth-notice" type="info" showIcon title="尚未配置全店设置"
      description="金额和期限已填入建议值，尚未生效。请核实运费，填写真实退货地址和服务电话，完成首次保存。" /> : null}
    <div aria-live="polite" className="settings-message"><AuthError error={error} />
      {blocked ? <Alert type="warning" showIcon title={blocked === 'conflict' ? '设置已更新，请重新确认' : '保存结果尚未确认'}
        description={blocked === 'conflict' ? '本次修改未保存。读取最新设置后，请重新核对并填写修改原因；当前未保存的表单会被替换。' : '请先读取最新设置，核对是否已保存，再决定是否修改。当前未保存的表单会被替换。'}
        action={<Button onClick={onReload}>读取最新版本并重新填写</Button>} /> : null}
    </div>
    {/* 表单随整个组件销毁；沿用员工管理的preserve=false，避免StrictMode清掉初始配置。 */}
    <Form form={form} name="store-settings" layout="vertical" preserve={false} scrollToFirstError={{ focus: true }}
      initialValues={settingsFormValues(current.currentSetting)} disabled={submitting || !!blocked} onFinish={submit}>
      <fieldset className="settings-group"><legend>运费规则</legend>
        <p className="settings-hint">以元填写，最多两位小数；系统按整数分保存。包邮门槛按商品金额判断。</p>
        <div className="settings-grid">
          <Form.Item name="shippingFeeYuan" label="基础运费（元）" required extra="0～10,000元" rules={[rule(value => yuanToCents(value, 1_000_000) === null ? '请输入0～10000元，最多两位小数' : null)]}>
            <Input inputMode="decimal" autoComplete="off" /></Form.Item>
          <Form.Item name="freeShippingThresholdYuan" label="包邮门槛（元）" required extra="0～1,000,000元；0表示全店包邮" rules={[rule(value => yuanToCents(value, 100_000_000) === null ? '请输入0～1000000元，最多两位小数' : null)]}>
            <Input inputMode="decimal" autoComplete="off" /></Form.Item>
        </div>
        <Form.Item name="freeShippingEnabled" valuePropName="checked" extra="关闭后仍保留门槛，后续重新开启时使用。"><Checkbox>开启满额包邮</Checkbox></Form.Item>
      </fieldset>
      <fieldset className="settings-group"><legend>退货地址</legend>
        <p className="settings-hint">仅供店铺管理及已同意退货的售后使用。顾客寄回地址以批准退货时的记录为准。</p>
        <div className="settings-grid">
          <Form.Item name={['returnAddress', 'receiver']} label="退货收件人" required rules={[textRule('退货收件人', 40)]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name={['returnAddress', 'phone']} label="退货联系电话" required rules={[rule(phoneIssue)]}><Input inputMode="tel" autoComplete="off" /></Form.Item>
          {([{ key: 'province', label: '省份' }, { key: 'city', label: '城市' }, { key: 'district', label: '区县' }] as const).map(field =>
            <Form.Item key={field.key} name={['returnAddress', field.key]} label={field.label} required rules={[textRule(field.label, 50)]}><Input autoComplete="off" /></Form.Item>)}
        </div>
        <Form.Item name={['returnAddress', 'detail']} label="详细地址" required rules={[textRule('详细地址', 200)]}><Input.TextArea rows={2} autoComplete="off" /></Form.Item>
      </fieldset>
      <fieldset className="settings-group"><legend>服务联系</legend>
        <p className="settings-hint">以下信息会公开展示在商城，请填写店铺对外使用的电话。</p>
        <div className="settings-grid">
          <Form.Item name={['serviceContact', 'phone']} label="公开服务电话" required rules={[rule(phoneIssue)]}><Input inputMode="tel" autoComplete="off" /></Form.Item>
          <Form.Item name={['serviceContact', 'serviceHours']} label="服务时间（选填）" extra="留空会清除已保存的服务时间" rules={[textRule('服务时间', 100, true)]}><Input placeholder="如：周一至周五 09:00～18:00" autoComplete="off" /></Form.Item>
        </div>
      </fieldset>
      <fieldset className="settings-group"><legend>处理期限</legend>
        <p className="settings-hint">按北京时间起算。自然日包含周末；工作日仅为周一至周五，暂不计算法定节假日和调休。修改只影响后续新阶段，已生效的期限保留。</p>
        <div className="settings-grid">
          {deadlineFields.map(field => <Form.Item key={field.key} name={['deadlines', field.key]} label={`${field.label}（${field.unit}）`} required
            extra={`${field.hint}；1～${field.max}${field.unit}`} rules={[rule(value => deadlineNumber(value, field.max) === null ? `请输入1～${field.max}的整数` : null)]}>
            <Input inputMode="numeric" autoComplete="off" suffix={field.unit} /></Form.Item>)}
        </div>
      </fieldset>
      <div className="settings-save">
        <Form.Item name="reason" label="修改原因" required extra="每次保存都须填写，最多500个字符" rules={[textRule('修改原因', 500)]}><Input.TextArea rows={3} autoComplete="off" /></Form.Item>
        <p className="settings-hint">基于版本 {current.version} 保存；有效修改会保留完整历史。</p>
        <Button type="primary" htmlType="submit" loading={submitting} disabled={submitting || !!blocked}>保存全店设置</Button>
      </div>
    </Form>
  </>;
}
