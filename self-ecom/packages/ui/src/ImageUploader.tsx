/** 文件作用：复用多图选择/预检/逐张上传/重试，成功只交付文件资料，业务绑定由页面另行确认。 */
import { useEffect, useId, useRef, useState } from 'react';
import { ApiClientError, type FileMetadata } from '@shop/api-client';
import { FileError } from './FileError.js';
import { PrivateImage } from './PrivateImage.js';
interface Item { key: string; file: File; state: 'uploading' | 'success' | 'error'; metadata?: FileMetadata; error?: unknown }
export interface ImageUploaderProps {
  maxCount: number;
  upload: (file: File, signal: AbortSignal) => Promise<FileMetadata>;
  load: (id: string, signal: AbortSignal) => Promise<Blob>;
  sessionKey: string | number;
  onChange: (files: FileMetadata[]) => void;
  disabled?: boolean;
  label?: string;
}
export function ImageUploader(props: ImageUploaderProps) {
  return <ImageUploaderContent key={props.sessionKey} {...props} />;
}
function ImageUploaderContent({ maxCount, upload, load, sessionKey, onChange, disabled = false, label = '选择图片' }: ImageUploaderProps) {
  const inputId = useId(); const [items, setItems] = useState<Item[]>([]); const [error, setError] = useState<unknown>(null);
  const current = useRef(items); const mounted = useRef(true); const tasks = useRef(new Map<string, AbortController>());
  const listener = useRef(onChange); listener.current = onChange;
  useEffect(() => {
    mounted.current = true; const controllers = tasks.current;
    return () => { mounted.current = false; for (const controller of controllers.values()) controller.abort(); controllers.clear(); };
  }, []);
  function publish(next: Item[]) {
    if (!mounted.current) return;
    current.current = next; setItems(next); listener.current(next.flatMap(item => item.metadata ? [item.metadata] : []));
  }
  async function send(item: Item) {
    if (tasks.current.has(item.key)) return;
    const controller = new AbortController(); tasks.current.set(item.key, controller);
    publish(current.current.map(row => row.key === item.key ? { ...row, state: 'uploading', error: undefined } : row));
    try {
      const metadata = await upload(item.file, controller.signal);
      if (!controller.signal.aborted) publish(current.current.map(row => row.key === item.key ? { ...row, state: 'success', metadata } : row));
    } catch (failure) {
      if (!controller.signal.aborted) publish(current.current.map(row => row.key === item.key ? { ...row, state: 'error', error: failure } : row));
    } finally { tasks.current.delete(item.key); }
  }
  async function select(files: File[]) {
    setError(null);
    if (!files.length || disabled) return;
    if (!Number.isInteger(maxCount) || maxCount < 1 || files.length + current.current.length > maxCount) {
      setError(new ApiClientError('IMAGE_COUNT_EXCEEDED', `最多选择${maxCount}张图片，请先移除已有选择`)); return;
    }
    const keys = new Set(current.current.map(item => item.key)); const added: Item[] = [];
    for (const file of files) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (keys.has(key)) { setError(new ApiClientError('IMAGE_DUPLICATE', '请勿重复选择同一图片')); return; }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 5242880) {
        setError(new ApiClientError('IMAGE_INVALID_SELECTION', '请选择非空的JPEG、PNG或WebP图片，每张不超过5MiB')); return;
      }
      keys.add(key); added.push({ key, file, state: 'uploading' });
    }
    publish([...current.current, ...added]);
    // 顺序上传避免一个选择动作占满后端并行处理名额；单项失败仍可手动重试。
    for (const item of added) { if (!mounted.current) break; await send(item); }
  }
  const uploading = items.some(item => item.state === 'uploading');
  return <div className="image-uploader">
    <label className="file-label" htmlFor={inputId}>{label}</label>
    <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple={maxCount > 1}
      disabled={disabled || uploading} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void select(files); }} />
    <p className="file-hint">JPEG、PNG、WebP，每张最多5MiB，最多{maxCount}张；不支持动画。图片须通过服务端校验。</p>
    <FileError error={error} />
    <ul className="file-list">{items.map(item => <li key={item.key}>
      <span className="file-name">{item.file.name}</span>
      {item.state === 'uploading' ? <span role="status">上传中…</span> : item.state === 'success' ? <>
        <span role="status">上传成功</span><PrivateImage fileId={item.metadata!.id} load={load} sessionKey={sessionKey} alt="待确认的图片预览" />
      </> : <><FileError error={item.error} /><button type="button" disabled={disabled} onClick={() => { void send(item); }}>重试上传</button></>}
      <button type="button" disabled={disabled || uploading} onClick={() => publish(current.current.filter(row => row.key !== item.key))}>移除此选择</button>
    </li>)}</ul>
  </div>;
}
