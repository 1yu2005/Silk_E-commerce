/** 文件作用：以带认证的Blob读取私有图片，替换/卸载时取消请求并释放对象URL，失败由用户手动重试。 */
import { useEffect, useState } from 'react';
import { FileError } from './FileError.js';
export interface PrivateImageProps {
  fileId: string;
  load: (id: string, signal: AbortSignal) => Promise<Blob>;
  alt: string;
  /** 会话版本变化时必须重新挂载，防止旧会话的Blob残留。 */
  sessionKey: string | number;
}
export function PrivateImage(props: PrivateImageProps) {
  return <PrivateImageContent key={`${props.sessionKey}:${props.fileId}`} {...props} />;
}
function PrivateImageContent({ fileId, load, alt }: PrivateImageProps) {
  const [url, setUrl] = useState<string | null>(null); const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true; let objectUrl: string | undefined;
    void load(fileId, controller.signal).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(failure => { if (active) setError(failure); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileId, load, attempt]);
  if (error) return <div><FileError error={error} /><button type="button" onClick={() => { setError(null); setAttempt(value => value + 1); }}>重新读取图片</button></div>;
  return url ? <img className="private-image" src={url} alt={alt} /> : <span role="status">图片读取中…</span>;
}
