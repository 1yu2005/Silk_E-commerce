/** 文件作用：协调头像选图、受控上传、确认绑定与移除，提交失败保留已上传文件供重试。 */
import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Space } from 'antd';
import { ApiClientError, type FileMetadata } from '@shop/api-client';
import { ImageUploader, FileError } from '@shop/ui';
import { customerAuth, files, session } from '../services/api';

const uploadAvatar = async (file: File, signal: AbortSignal) => (await files.upload('CUSTOMER_AVATAR', file, signal)).data;
const loadImage = (id: string, signal: AbortSignal) => files.content(id, signal);
export function AvatarEditor({ avatarUrl }: { avatarUrl: string | null }) {
  const [editing, setEditing] = useState(false); const [selected, setSelected] = useState<FileMetadata[]>([]);
  const [saving, setSaving] = useState(false); const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true); const busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function change(fileId: string | null) {
    if (busy.current) return;
    const file = selected[0];
    if (fileId && file?.expiresAt && new Date(file.expiresAt).getTime() <= Date.now()) {
      setError(new ApiClientError('FILE_NOT_BINDABLE', '图片已过期，请移除此选择后重新上传')); return;
    }
    busy.current = true; setSaving(true); setError(null);
    try {
      if (await customerAuth.changeAvatar(fileId) && mounted.current) { setEditing(false); setSelected([]); }
    } catch (failure) { if (mounted.current) setError(failure); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  }
  return <div className="avatar-editor"><div className="avatar-summary">
    <Avatar size={80} src={avatarUrl ? <img src={avatarUrl} alt="当前头像" /> : undefined}>{avatarUrl ? null : '头像'}</Avatar>
    <div><h2>个人头像</h2><p className="muted">头像会公开展示，请勿上传售后凭证或私人资料。更换或移除后，旧图片链接仍会保留。</p></div>
  </div><FileError error={error} />
    {editing ? <>
      <ImageUploader key={session.getSnapshot().revision} maxCount={1} upload={uploadAvatar} load={loadImage}
        sessionKey={session.getSnapshot().revision} onChange={setSelected} disabled={saving} label="选择头像图片" />
      <Space wrap><Button type="primary" loading={saving} disabled={saving || !selected.length} onClick={() => { void change(selected[0]!.id); }}>保存头像</Button>
        <Button disabled={saving} onClick={() => { setEditing(false); setSelected([]); setError(null); }}>取消</Button></Space>
    </> : <Space wrap><Button disabled={saving} onClick={() => { setEditing(true); setError(null); }}>更换头像</Button>
      <Button disabled={saving || !avatarUrl} loading={saving} onClick={() => { void change(null); }}>移除头像</Button></Space>}
  </div>;
}
