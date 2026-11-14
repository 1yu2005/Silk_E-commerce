import {Transform} from 'class-transformer';
import {IsIn,IsInt,Max,Min} from 'class-validator';
import {strictInteger} from '../common/http/dto-transforms.js';
export class TrendQueryDto {
 @Transform(({value}:{value:unknown})=>strictInteger(value)) @IsIn([7,30]) days:number=7;
}
export class HotProductsQueryDto {
 @Transform(({value}:{value:unknown})=>strictInteger(value)) @IsIn([30]) days:number=30;
 @Transform(({value}:{value:unknown})=>strictInteger(value)) @IsInt() @Min(1) @Max(20) limit:number=10;
}
