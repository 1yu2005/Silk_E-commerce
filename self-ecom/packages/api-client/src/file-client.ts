/** 文件作用：通过既有本域认证传输上传图片、读取安全元数据及私有Blob，不接受任意下载地址。 */
import type { AxiosInstance } from 'axios';
import type { ApiResponse, FileMetadata, FilePurpose } from '@shop/shared';
import { ApiClientError } from './api-error.js';
import { createGeneratedClient } from './generated/client.js';
import type { operations } from './generated/schema.js';
function idPath(id: string) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiClientError('CLIENT_REQUEST_TARGET_INVALID', '图片编号不合法');
  }
  return `/files/${id.toLowerCase()}`;
}
export function createFileClient(api: AxiosInstance) {
  const json = createGeneratedClient(api);
  return {
    async upload(purpose: FilePurpose, file: File, signal?: AbortSignal): Promise<ApiResponse<FileMetadata>> {
      const body = new FormData(); body.append('purpose', purpose); body.append('file', file);
      // 让浏览器生成带boundary的Content-Type，不能手工写死multipart头。
      return (await api.post<operations['uploadImage']['responses'][201]['content']['application/json']>('/files', body, { signal, timeout: 45000 })).data;
    },
    async metadata(id: string, signal?: AbortSignal): Promise<ApiResponse<FileMetadata>> {
      idPath(id); return json.getFileMetadata({ path: { id }, signal });
    },
    async content(id: string, signal?: AbortSignal): Promise<Blob> {
      const response = await api.get<Blob>(`${idPath(id)}/content`, { responseType: 'blob', signal });
      if (!(response.data instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(response.data.type)) {
        throw new ApiClientError('FILE_RESPONSE_INVALID', '图片响应不合法', response.status,
          typeof response.headers['x-request-id'] === 'string' ? response.headers['x-request-id'] : undefined);
      }
      return response.data;
    },
  };
}
