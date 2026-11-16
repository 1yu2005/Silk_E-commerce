import assert from 'node:assert/strict';
import {test} from 'node:test';
import {safeHttpEvidence} from '../module15-http-evidence.mjs';
test('nested credentials, private fields and free text cannot enter public request evidence',()=>{
 const secret='private-value-that-must-not-be-public';
 const result=safeHttpEvidence({password:secret,accessToken:secret,items:[{skuId:secret,productName:secret,quantity:2}],shippingAddress:{phone:secret},reason:secret,custom:{value:secret},error:{message:secret}});
 assert.ok(!JSON.stringify(result).includes(secret));assert.equal(result.items[0].quantity,2);assert.equal(result.shippingAddress,'[REDACTED]');
});
test('business IDs, stable keys, versions, quantities and state transitions remain reviewable',()=>{
 const value={id:'52a7e69c-5ebe-49ba-9b1d-ae0ddf98e186',commandKey:'refund:stable-key-1',expectedVersion:2,quantity:1,status:'REFUNDED',attemptOutcome:'SUCCEEDED',fulfillmentStage:'SHIPPED',completedAt:'2026-11-15T01:00:00.000Z',replayed:true};
 assert.deepEqual(safeHttpEvidence(value),value);
 assert.equal(safeHttpEvidence({commandKey:'contains whitespace private text'}).commandKey,'[REDACTED_FREE_TEXT]');
});
