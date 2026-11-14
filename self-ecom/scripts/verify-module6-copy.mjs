// 作用：入账上架后的演示介绍定向复验；只读公开商品，保留本机与Docker最终截图。
/* global document, innerWidth */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const output='output/playwright/M1-06/final-copy';await mkdir(output,{recursive:true});
const demo=JSON.parse(await readFile('docs/verification/evidence/M1-06/development-demo-run2.json','utf8'));
const report={at:new Date().toISOString(),checks:[],pageErrors:[]};
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
try{
  for(const [label,origin]of [['native','http://localhost:5174'],['docker','http://localhost:8081']])for(const [index,item]of demo.products.entries()){
    const page=await browser.newPage({viewport:{width:index?390:1366,height:index?844:900}});page.on('pageerror',e=>report.pageErrors.push(e.name));
    await page.goto(origin+'/products/'+item.id);await page.getByRole('button',{name:index?'黑色':'白色',exact:true}).click();await page.getByRole('button',{name:index?'L':'M',exact:true}).click();await page.getByText(/此款有货/).waitFor();
    const description=await page.locator('.product-description').innerText();assert.ok(description.includes('演示数量已通过正式库存登记确认'));assert.ok(!description.includes('库存登记尚未确认'));
    await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const screenshot=label+'-'+(index?'jacket-mobile':'tshirt')+'.png';await page.screenshot({path:output+'/'+screenshot,fullPage:true});
    report.checks.push({origin,productId:item.id,version:item.version,description,screenshot});await page.close();
  }
  assert.deepEqual(report.pageErrors,[]);report.passed=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{await browser.close();await writeFile(output+'/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
