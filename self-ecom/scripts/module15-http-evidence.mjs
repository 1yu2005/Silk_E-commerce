// 作用：验收保留结构、数量、版本、状态及稳定操作键；自由文本和身份凭据只留占位。
export function safeHttpEvidence(value,key=''){
 if(/password|secret|token|phone|receiver|address|nickname|username|displayName|email|note|reason|message|location|tracking|contact|name|evidence/i.test(key))return '[REDACTED]';
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number')return Number.isFinite(value)?value:'[REDACTED]';
 if(Array.isArray(value))return value.map(item=>safeHttpEvidence(item,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,safeHttpEvidence(item,name)]));
 if(typeof value==='string'){
  if(/ids?$/i.test(key)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))return value;
  if(/^(commandKey|batchKey|actionKey|entryKey|number|orderNo|businessNo)$/.test(key)&&/^[A-Za-z0-9_:.-]{1,128}$/.test(value))return value;
  if(/(?:status|type|action|code|outcome|stage)$/i.test(key)&&/^[A-Z][A-Z0-9_]{0,79}$/.test(value))return value;
  if(/^(?:from|to)$|(?:At|Deadline)$/.test(key)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return value;
  return '[REDACTED_FREE_TEXT]';
 }
 return '[REDACTED]';
}
