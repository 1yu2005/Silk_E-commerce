// HTML pattern 使用 Unicode Sets（v）语法，直接验证页面属性，避免浏览器静默忽略非法规则。
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import ts from 'typescript';

const appsRoot=fileURLToPath(new URL('../../',import.meta.url));

function attributeValue(attribute,source){
  const initializer=attribute.initializer;
  if(initializer&&ts.isStringLiteral(initializer))return initializer.text;
  const expression=initializer&&ts.isJsxExpression(initializer)?initializer.expression:undefined;
  if(expression&&ts.isPropertyAccessExpression(expression)&&expression.name.text==='source'&&ts.isIdentifier(expression.expression)){
    const name=expression.expression.text;
    for(const statement of source.statements){
      if(!ts.isVariableStatement(statement))continue;
      for(const declaration of statement.declarationList.declarations){
        if(!ts.isIdentifier(declaration.name)||declaration.name.text!==name||!declaration.initializer||!ts.isRegularExpressionLiteral(declaration.initializer))continue;
        const literal=declaration.initializer.text,lastSlash=literal.lastIndexOf('/');
        return new RegExp(literal.slice(1,lastSlash),literal.slice(lastSlash+1)).source;
      }
    }
  }
  assert.fail(`需要解析实际 pattern 值：${attribute.getText(source)}`);
}

function pagePatterns(){
  const rows=[];
  for(const app of ['admin-web','store-web']){
    const root=join(appsRoot,app,'src');
    for(const file of readdirSync(root,{recursive:true}).filter(file=>file.endsWith('.tsx'))){
      const path=join(root,file),source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      function visit(node){
        if(ts.isJsxAttribute(node)&&node.name.getText(source)==='pattern'){
          const name=node.parent.properties.find(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(source)==='name');
          rows.push({file:relative(appsRoot,path).replaceAll('\\','/'),field:name?.initializer&&ts.isStringLiteral(name.initializer)?name.initializer.text:undefined,value:attributeValue(node,source)});
        }
        ts.forEachChild(node,visit);
      }
      visit(source);
    }
  }
  return rows;
}

const patterns=pagePatterns();
const wholePattern=value=>new RegExp(`^(?:${value})$`,'v');

test('后台与商城的所有实际 HTML pattern 均能在浏览器 v 模式编译',()=>{
  assert.ok(patterns.length>0,'必须找到页面中的真实 pattern 属性');
  const errors=[];
  for(const pattern of patterns){
    try{wholePattern(pattern.value);}catch(error){errors.push(`${pattern.file} (${pattern.field}): ${error.message}`);}
  }
  assert.deepEqual(errors,[]);
});

test('SKU编码、运单号与电话继续接受连字符，并拒绝原本不允许的字符',()=>{
  const examples=[
    {file:'admin-web/src/catalog/ProductSkus.tsx',field:'code',valid:['S-ABC_123','sku123'],invalid:['SKU/01','A B','中文']},
    {file:'store-web/src/pages/AddressPage.tsx',field:'phone',valid:['13900000001','+86 139-0000-0001'],invalid:['ab123','123_456','12','1'.repeat(31)]},
    ...patterns.filter(row=>row.field==='tracking').map(row=>({...row,valid:['SF-123','abc123'],invalid:['A_B','A B','123/456','中文']})),
  ];
  for(const example of examples){
    const row=patterns.find(row=>row.file===example.file&&row.field===example.field);
    assert.ok(row,`${example.file} 必须保留对应的表单校验`);
    const regex=wholePattern(row.value);
    for(const value of example.valid)assert.equal(regex.test(value),true,`${row.file} 应接受 ${value}`);
    for(const value of example.invalid)assert.equal(regex.test(value),false,`${row.file} 应拒绝 ${value}`);
  }
});
