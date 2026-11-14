// 作用：库存契约明确人工类型、来源净量、任务版本和可空结果，禁止浏览器提交库存效果。
import { applyDecorators, Header } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiUnauthorizedResponse, type OpenAPIObject } from '@nestjs/swagger';
import { object, array, int, text, uuid } from '../catalog/catalog.openapi.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
type Schema=NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
const bool:Schema={type:'boolean'},date:Schema={type:'string',format:'date-time'},nullable=(schema:Schema):Schema=>({...schema,nullable:true});
export const types:Schema={type:'string',enum:['INITIALIZATION','ARRIVAL','AVAILABLE_LOSS','CORRECTION']};
export const status:Schema={type:'string',enum:['PENDING','POSTED','VOID']};
const sourceType:Schema={type:'string',enum:['RECEIPT','LOSS']},actorType:Schema={type:'string',enum:['EMPLOYEE','CUSTOMER','SYSTEM']};
export const version={expectedVersion:int(2147483646)},reason={reason:text(500,1)},evidence={evidenceNote:text(2000,1),evidenceFileIds:{...array(uuid,5),uniqueItems:true}};
export const command=object({...version,expectedTaskVersion:int(2147483646)});
export const voidBody=object({...version,expectedTaskVersion:int(2147483646),...reason});
export const resolveBody=object({...version,expectedTaskVersion:int(2147483646),...reason,...evidence},['expectedVersion','expectedTaskVersion','reason','evidenceNote']);
const attachment=object({id:uuid,contentUrl:text(200)});
const sourceBase={id:uuid,sourceType,namespace:text(80,1),reference:text(100,1),normalizedReference:text(150,1),note:nullable(text(2000)),version:int(),createdById:uuid,createdAt:date,updatedAt:date};
const batch=object({id:uuid,sourceLineId:uuid,batchKey:text(80,1),rootAdjustmentLineId:uuid,createdAt:date,adjustmentId:uuid,adjustmentNumber:text(64),corrections:array(object({id:uuid,number:text(64),status}))});
const sourceLine=object({id:uuid,sourceId:uuid,lineKey:text(64,1),skuId:uuid,skuCode:text(64,1),verifiedQuantity:int(2147483647,1),netPostedQuantity:int(),version:int(),createdAt:date,updatedAt:date,batches:array(batch)});
export const sourceDetail=object({...sourceBase,lines:array(sourceLine),evidence:array(attachment),changed:bool},[...Object.keys(sourceBase),'lines','evidence']);
const sourceLineFields={lineKey:text(64,1),skuId:uuid,verifiedQuantity:int(2147483647,1)};
export const sourceLineInput=object(sourceLineFields);
export const sourceCreate=object({sourceType,namespace:text(80,1),reference:text(100,1),note:text(2000,1),evidenceFileIds:evidence.evidenceFileIds,lines:{...array(sourceLineInput,200),minItems:1}},['sourceType','namespace','lines']);
export const sourceAdd=object({...sourceLineFields,expectedSourceVersion:int(2147483646),...reason});
export const sourceVerify=object({...version,...reason,verifiedQuantity:int(2147483647,1),...evidence},['expectedVersion','reason','verifiedQuantity','evidenceNote']);
const block=object({id:uuid,sourceType:text(40),sourceId:uuid,reasonCode:text(80),createdAt:date});
const balanceFields={skuId:uuid,code:text(64),productId:uuid,productName:text(120),choices:array(text(100)),available:int(),reserved:int(),warningThreshold:int(),lowStock:bool,purchaseBlocked:bool,version:int(),blocks:array(block)};
export const balance=object({...balanceFields,changed:bool},Object.keys(balanceFields));
const ledgerFields={id:uuid,actionId:uuid,skuId:uuid,sequence:int(2147483647,1),eventType:text(50),beforeA:int(),beforeR:int(),afterA:int(),afterR:int(),deltaA:int(2147483647,-2147483647),deltaR:int(2147483647,-2147483647),quantityReleased:nullable(int()),quantityDamaged:nullable(int()),
 sourceLineId:nullable(uuid),rootAdjustmentLineId:nullable(uuid),businessType:text(40),businessId:uuid,businessNumber:text(64),reason:text(500),actorType,actorEmployeeId:nullable(uuid),actorCustomerId:nullable(uuid),requestId:uuid,createdAt:date};
const ledger=object(ledgerFields);
const actionFields={id:uuid,businessType:text(40),businessId:uuid,actionType:text(50),actionKey:text(180),requestFingerprint:text(64),adjustmentId:nullable(uuid),resultSummary:object({actionId:uuid,ledgerIds:array(uuid)}),actorType,actorEmployeeId:nullable(uuid),actorCustomerId:nullable(uuid),requestId:uuid,createdAt:date};
export const action=object({...actionFields,ledger:array(ledger)});
const adjustmentBase={id:uuid,number:text(64),type:types,status,reason:text(500),evidenceNote:nullable(text(2000)),createdById:uuid,postedById:nullable(uuid),voidedById:nullable(uuid),postedAt:nullable(date),voidedAt:nullable(date),version:int(),
 conversionKey:nullable(uuid),conversionFingerprint:nullable(text(64)),conversionSnapshot:nullable(object({draftId:uuid,quantities:array(object({skuId:uuid,quantity:int()})),sourceId:uuid,mappings:array(object({skuId:uuid,sourceLineId:uuid,batchKey:text(80)})),reason:text(500),evidenceNote:text(2000),evidenceFileIds:array(uuid)})),
 checkRequired:bool,checkReasonCode:nullable(text(80)),createdAt:date,updatedAt:date};
const line=object({id:uuid,adjustmentId:uuid,type:types,skuId:uuid,sourceLineId:uuid,batchKey:nullable(text(80)),quantity:nullable(int(2147483647,1)),signedDeltaA:nullable(int(2147483647,-2147483647)),rootLineId:nullable(uuid),skuCode:text(64),available:int(),reserved:int(),deltaA:int(2147483647,-2147483647),sourceId:uuid,rootAdjustmentId:nullable(uuid)});
const task=object({id:uuid,stage:{type:'string',enum:['INVENTORY_POST','INVENTORY_RECONCILE']},status:{type:'string',enum:['OPEN','CLAIMED','SUSPENDED','COMPLETED','CANCELLED']},assigneeId:nullable(uuid),version:int(),round:int(2147483647,1),dueAt:nullable(date),reassignNeeded:bool});
const history=object({id:uuid,aggregateType:{type:'string',enum:['INVENTORY_ADJUSTMENT']},aggregateId:uuid,dimension:text(50),commandKey:text(150),fromState:nullable(text(80)),toState:text(80),actorType,actorEmployeeId:nullable(uuid),actorCustomerId:nullable(uuid),reason:nullable(text(500)),publicText:nullable(text(2000)),requestId:uuid,createdAt:date});
export const adjustmentDetail=object({...adjustmentBase,adjustmentVersion:int(),taskVersion:nullable(int()),lines:array(line),sources:array(sourceDetail),evidence:array(attachment),task:nullable(task),tasks:array(task),action:nullable(object(actionFields)),ledger:array(ledger),history:array(history),changed:bool,converted:bool},[...Object.keys(adjustmentBase),'adjustmentVersion','taskVersion','lines','sources','evidence','task','tasks','action','ledger','history']);
const manualLine=object({skuId:uuid,sourceLineId:uuid,batchKey:text(80,1),quantity:int(2147483647,1)},['skuId','sourceLineId','quantity']);
export const adjustmentCreate=object({type:{type:'string',enum:['INITIALIZATION','ARRIVAL','AVAILABLE_LOSS']},...reason,...evidence,lines:{...array(manualLine,100),minItems:1}},['type','reason','lines']);
const correctionLine=object({rootLineId:uuid,signedDeltaA:int(2147483647,-2147483647)});
export const correction=object({...reason,...evidence,lines:{...array(correctionLine,100),minItems:1}},['reason','lines']);
export const adjustmentEdit=object({...version,type:types,...reason,...evidence,lines:{...array({oneOf:[manualLine,correctionLine]},200),minItems:1}},['expectedVersion','type','reason','lines']);
export const conversion=object({expectedProductVersion:int(2147483646),expectedDraftVersion:int(2147483646),sourceId:uuid,mappings:{...array(object({skuId:uuid,sourceLineId:uuid,batchKey:text(80,1)}),200),minItems:1},...reason,...evidence},['expectedProductVersion','expectedDraftVersion','sourceId','mappings','reason']);
const list=(item:Schema,extra:Record<string,Schema>={})=>object({items:array(item),total:int(Number.MAX_SAFE_INTEGER),page:int(1000000,1),pageSize:int(100,1),...extra});
const decimal:Schema={type:'string',pattern:'^[0-9]+$'};
export const balanceList=list(balance,{availableTotal:decimal,reservedTotal:decimal}),sourceList=list(object(sourceBase)),adjustmentList=list(object(adjustmentBase)),ledgerList=list(ledger);
export function Protected(){return applyDecorators(ApiBearerAuth('bearerAuth'),ApiUnauthorizedResponse({schema:authErrorSchema(['TOKEN_INVALID','SESSION_REVOKED'])}),ApiForbiddenResponse({schema:authErrorSchema(['FORBIDDEN','PASSWORD_CHANGE_REQUIRED'])}));}
export function Params(name='id'){return ApiParam({name,format:'uuid'});}
export function QueryFields(names:readonly string[]){return applyDecorators(...names.map(name=>ApiQuery({name,required:false,schema:name==='page'||name==='pageSize'?int(name==='page'?1000000:100,1):name==='lowStock'||name==='purchaseBlocked'?{type:'string',enum:['true','false']}:name.endsWith('Id')?uuid:name==='sourceType'?sourceType:name==='status'?status:name==='type'?types:{type:'string',maxLength:120}})));}
// 冲突可携带已授权的原单或待核实摘要，格式区别于字段校验错误数组。
function conflictSchema(codes:string[]):Schema {const schema=authErrorSchema(codes);return {...schema,properties:{...('properties' in schema?schema.properties:{}),details:object({adjustmentId:uuid,number:text(64),checkRequired:bool},[])}};}
export function Endpoint(operationId:string,summary:string,response:Schema,body?:Schema,created=false){return applyDecorators(Header('Cache-Control','no-store'),ApiOperation({operationId,summary,description:'库存命令在同一事务复核当前权限、经办和版本。PENDING不入账；核实失败可以合法提交待办后返回409。来源附件私有；不接受任意A/R效果。'}),
 ...(body?[ApiBody({required:true,schema:body})]:[]),(created?ApiCreatedResponse:ApiOkResponse)({headers:requestIdHeader,schema:object({data:response,requestId:uuid})}),
 ApiBadRequestResponse({schema:authErrorSchema(['VALIDATION_FAILED'])}),ApiNotFoundResponse({schema:authErrorSchema(['INVENTORY_NOT_FOUND','SOURCE_NOT_FOUND','ADJUSTMENT_NOT_FOUND'])}),
 ApiConflictResponse({schema:conflictSchema(['VERSION_CONFLICT','SOURCE_ALREADY_EXISTS','SOURCE_BATCH_ALREADY_POSTED','SOURCE_QUANTITY_EXCEEDED','SOURCE_QUANTITY_BELOW_POSTED','STOCK_INSUFFICIENT','INVENTORY_LIMIT_EXCEEDED','CORRECTION_NOT_ALLOWED','INVENTORY_ACTION_CONFLICT','INITIAL_CONVERSION_CONFLICT','INITIAL_DRAFT_EMPTY','INITIAL_DRAFT_NOT_EDITABLE','ADJUSTMENT_NOT_PENDING','TASK_NOT_ASSIGNEE','INVENTORY_CHECK_REQUIRED','INVENTORY_CHECK_UNRESOLVED'])}));}
