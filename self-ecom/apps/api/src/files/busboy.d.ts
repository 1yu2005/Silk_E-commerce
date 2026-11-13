// 作用：为固定版本busboy声明本项目实际使用的最小流式接口，不引入运行时封装。
declare module 'busboy' {
  import type { IncomingHttpHeaders } from 'node:http';
  import type { Readable, Writable } from 'node:stream';
  interface FileStream extends Readable { truncated: boolean }
  interface Parser extends Writable {
    on(event: 'file', listener: (name: string, file: FileStream) => void): this;
    on(event: 'field', listener: (name: string, value: string, info: { valueTruncated: boolean; nameTruncated: boolean }) => void): this;
    on(event: string, listener: (...args: never[]) => void): this;
  }
  function busboy(options: { headers: IncomingHttpHeaders; limits: { fileSize: number; files: number; fields: number; parts: number; fieldSize: number; fieldNameSize: number; headerPairs: number } }): Parser;
  export = busboy;
}
