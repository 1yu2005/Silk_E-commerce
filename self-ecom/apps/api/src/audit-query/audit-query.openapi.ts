// 作用：声明安全审计投影的固定契约，禁止任意JSON或原始载荷响应。
const text={type:'string'} as const;
const id={type:'string',format:'uuid'} as const;
const date={type:'string',format:'date-time'} as const;
const nullable=(schema:object)=>({anyOf:[schema,{type:'null'}]});
const object=(properties:Record<string,object>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const array=(items:object)=>({type:'array',items});
const integer={type:'integer',minimum:0} as const;
const boolean={type:'boolean'} as const;
const safeValue={anyOf:[text,{type:'integer'},boolean,array(text),{type:'null'}]};
export const auditEmployeeSchema=object({id,username:nullable(text),displayName:text,disabled:boolean});
export const auditItemSchema=object({
  id,actor:object({type:{type:'string',enum:['EMPLOYEE','CUSTOMER','SYSTEM']},id:nullable(id),employee:nullable(auditEmployeeSchema)}),
  action:text,actionLabel:text,detailsAvailable:boolean,detailNotice:text,hasReason:boolean,reason:nullable(text),
  changes:array(object({field:text,label:text,before:safeValue,after:safeValue})),targetType:text,targetId:nullable(id),
  requestId:nullable(text),createdAt:date,businessReferences:array(object({businessType:text,businessId:nullable(id),businessNo:nullable(text)})),
});
const itemProperties=auditItemSchema.properties;
const envelope=(data:object)=>object({data,requestId:text});
export const auditListSchema=envelope(object({items:array(auditItemSchema),total:integer,page:{type:'integer',minimum:1},pageSize:{type:'integer',minimum:1,maximum:100},
  asOf:date,timeZone:{type:'string',enum:['Asia/Shanghai']},from:date,to:date,coverageNotice:text}));
export const auditDetailSchema=envelope(object({...itemProperties,asOf:date}));
export const auditOptionsSchema=envelope(object({actorTypes:array(text),actions:array(object({value:text,label:text})),targetTypes:array(text),businessTypes:array(text),
  employees:array(auditEmployeeSchema),employeeLimit:{type:'integer',minimum:1,maximum:100},identityNotice:text}));
