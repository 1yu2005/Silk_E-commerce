// 作用：无业务入参的命令严格接受空对象或无请求体，拒绝金额等额外字段。
import type {PipeTransform} from '@nestjs/common';
import {DtoValidationException} from './dto-validation.js';
export class EmptyBodyPipe implements PipeTransform<unknown,void> {
 transform(value:unknown):void {
  if(value===undefined)return;
  if(value===null||typeof value!=='object'||Array.isArray(value)
   ||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==0){
   throw new DtoValidationException([{field:'body',message:'仅允许空对象或无请求体'}]);
  }
 }
}
