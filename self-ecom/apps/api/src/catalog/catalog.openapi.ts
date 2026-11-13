// 作用：商品契约明确整数分、十进制汇总、可空价格和字段裁剪；公开结构没有成本或占用。
import { applyDecorators, Header } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiCreatedResponse, ApiOperation, ApiParam, ApiQuery, ApiUnauthorizedResponse, type OpenAPIObject } from '@nestjs/swagger';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
type Schema=NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const uuid:Schema={type:'string',format:'uuid'};
const bool:Schema={type:'boolean'};
const date:Schema={type:'string',format:'date-time'};
export const int=(maximum=2147483647,minimum=0):Schema=>({type:'integer',minimum,maximum});
export const text=(maxLength:number,minLength=0):Schema=>({type:'string',minLength,maxLength});
const nullable=(schema:Schema):Schema=>({...schema,nullable:true});
export const array=(items:Schema,maxItems?:number):Schema=>({type:'array',items,...(maxItems===undefined?{}:{maxItems})});
export const object=(properties:Record<string,Schema>,required=Object.keys(properties)):Schema=>({type:'object',additionalProperties:false,properties,required});
const decimal:Schema={type:'string',pattern:'^[0-9]+$',description:'十进制整数，避免汇总超出JavaScript安全整数'};
const status:Schema={type:'string',enum:['DRAFT','ON_SALE','OFF_SALE']};
export const versionFields={expectedVersion:int(2147483646)};
export const reasonFields={...versionFields,reason:text(500,1)};
export const categoryFields={name:text(50,1),parentId:nullable(uuid),iconKey:{type:'string',nullable:true,enum:['clothes','top','trousers','coat','dress','accessory',null]} as Schema,sortOrder:int(1000000)};
const categoryBase={id:uuid,...categoryFields};
const categoryAdmin={depth:int(3,1),pathIds:array(uuid,3),version:int()};
export function treeSchema(admin:boolean,depth=1):Schema{return array(object({...categoryBase,...(admin?categoryAdmin:{}),children:depth<3?treeSchema(admin,depth+1):array(object({}),0)}));}
export const categoryWrite=object({...categoryBase,...categoryAdmin,nameKey:text(100),deletedAt:nullable(date),createdAt:date,updatedAt:date,changed:bool,affected:int()});
export const profileFields={name:text(120,1),brand:nullable(text(80)),description:nullable(text(20000)),categoryId:nullable(uuid)};
export const imagesFields={...versionFields,mainImageId:nullable(uuid),galleryImageIds:array(uuid,10)};
const valueFields={id:uuid,clientKey:uuid,name:text(30,1)};
export const dimensions=array(object({...valueFields,values:{...array(object(valueFields,['name']),20),minItems:1}},['name','values']),3);
const dimensionResponse=object({id:uuid,name:text(30,1),values:array(object({id:uuid,name:text(30,1)}),20)});
const choice=object({dimensionId:uuid,valueId:uuid,dimension:text(30,1),value:text(30,1)});
const skuBase={id:uuid,code:{...text(64,1),pattern:'^[A-Z0-9_-]+$'},priceCents:nullable(int(1000000,1)),available:int(),purchasable:bool,choices:array(choice,3)};
const skuAdmin={enabled:bool,retiredAt:nullable(date),costCents:nullable(int(1000000)),reserved:int(),purchaseBlocked:bool,warningThreshold:int()};
const summary={id:uuid,name:text(120,1),brand:nullable(text(80)),mainImageUrl:nullable(text(200)),priceFromCents:nullable(int(1000000,1)),availableQuantity:decimal,paidSalesCount:decimal,purchasable:bool};
const draftSummary={id:uuid,status:{type:'string',enum:['EDITABLE','CONVERTED','VOID']} as Schema,version:int(),conversionKey:uuid};
export const draftSchema=object({...draftSummary,productId:uuid,createdById:uuid,createdAt:date,updatedAt:date,lines:array(object({skuId:uuid,quantity:int()}),200)});
export function detailSchema(admin:boolean,command=false):Schema{return object({...summary,description:nullable(text(20000)),galleryImageUrls:array(text(200),10),categoryPath:array(object({id:uuid,name:text(50,1)}),3),specDimensions:array(dimensionResponse,3),skus:array(object({...skuBase,...(admin?skuAdmin:{})},Object.keys({...skuBase,...(admin?{enabled:bool,retiredAt:date}:{})}))),
  ...(admin?{productCode:text(64,1),categoryId:nullable(uuid),status,archivedAt:nullable(date),version:int(),mainImageId:nullable(uuid),galleryImageIds:array(uuid,10),initialInventoryDraft:nullable(object(draftSummary))}:{}),
  ...(command?{changed:bool,clientKeyMap:{type:'object',additionalProperties:uuid} as Schema,draft:draftSchema}:{})
},[...Object.keys(summary),'description','galleryImageUrls','categoryPath','specDimensions','skus',...(admin?['productCode','categoryId','status','archivedAt','version','mainImageId','galleryImageIds','initialInventoryDraft']:[]),...(command?['changed']:[])]);}
export function listSchema(admin:boolean):Schema{return object({items:array(object({...summary,...(admin?{status,version:int(),archivedAt:nullable(date)}:{})})),total:int(Number.MAX_SAFE_INTEGER),page:int(Number.MAX_SAFE_INTEGER,1),pageSize:int(100,1)});}
export const priceFields={priceCents:nullable(int(1000000,1)),costCents:nullable(int(1000000))};
export const draftFields={expectedProductVersion:int(2147483646),expectedDraftVersion:nullable(int(2147483646)),lines:array(object({skuId:uuid,quantity:int()}),200)};
export const previewSchema=object({count:int(200,1),maximum:int(200,200),combinations:array(object({choices:array(object({dimensionId:uuid,valueId:uuid}),3),reusableSkuId:nullable(uuid)}),200)});
export const batchBody=object({action:{type:'string',enum:['PUBLISH','UNPUBLISH']},items:{...array(object({id:uuid,...versionFields}),100),minItems:1},reason:text(500,1)});
export const batchResult=object({items:array(object({id:uuid,success:bool,version:int(),code:text(80),message:text(500)},['id','success']),100)});
export function CatalogEndpoint(operationId:string,summaryText:string,response:Schema,body?:Schema,created=false){return applyDecorators(
  Header('Cache-Control','no-store'),ApiOperation({operationId,summary:summaryText,description:'严格字段白名单；金额为整数分。写命令锁内复核会话权限、统一版本及审计。公开查询无需登录；初始数量草稿不入账。'}),
  ...(body?[ApiBody({required:true,schema:body})]:[]),
  (created?ApiCreatedResponse:ApiOkResponse)({headers:requestIdHeader,schema:object({data:response,requestId:uuid})}),
  ApiBadRequestResponse({headers:requestIdHeader,schema:authErrorSchema(['VALIDATION_FAILED','SKU_COMBINATION_LIMIT'])}),
  ApiNotFoundResponse({headers:requestIdHeader,schema:authErrorSchema(['CATEGORY_NOT_FOUND','PRODUCT_NOT_FOUND','SKU_NOT_FOUND'])}),
  ApiConflictResponse({headers:requestIdHeader,schema:authErrorSchema(['VERSION_CONFLICT','CATEGORY_NAME_EXISTS','CATEGORY_IN_USE','CATEGORY_CYCLE','CATEGORY_DEPTH_EXCEEDED','SKU_CODE_EXISTS','SKU_COMBINATION_EXISTS','PRODUCT_NOT_PUBLISHABLE','PRODUCT_ARCHIVED','PRODUCT_MUST_UNPUBLISH','SKU_SCHEME_REFERENCED','SKU_PRICE_REQUIRED','INITIAL_DRAFT_NOT_EDITABLE','SKU_REFERENCE_NOT_READY','FILE_NOT_BINDABLE','FILE_PURPOSE_MISMATCH'])}));}
export const CatalogProtected=()=>applyDecorators(ApiBearerAuth('bearerAuth'),ApiUnauthorizedResponse({headers:requestIdHeader,schema:authErrorSchema(['TOKEN_INVALID','TOKEN_EXPIRED','SESSION_REVOKED','ACCOUNT_UNAVAILABLE'])}),ApiForbiddenResponse({headers:requestIdHeader,schema:authErrorSchema(['FORBIDDEN','PASSWORD_CHANGE_REQUIRED'])}));
export const CatalogParams=(sku=false)=>applyDecorators(ApiParam({name:'id',schema:uuid}),...(sku?[ApiParam({name:'skuId',schema:uuid})]:[]));
export function CatalogListQuery(admin=false){return applyDecorators(...Object.entries({page:int(Number.MAX_SAFE_INTEGER,1),pageSize:int(100,1),keyword:text(50),categoryId:uuid,sort:{type:'string',enum:['NEWEST','PRICE_ASC','PRICE_DESC','SALES_DESC']} as Schema,...(admin?{status,archived:bool,minPriceCents:int(1000000,1),maxPriceCents:int(1000000,1)}:{})}).map(([name,schema])=>ApiQuery({name,required:false,schema})));}
