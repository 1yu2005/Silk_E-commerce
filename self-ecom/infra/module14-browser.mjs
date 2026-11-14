// 作用：浏览器资料和产物使用明确工作区目录，关闭浏览器时不触发Playwright临时目录递归删除。
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
export async function launchModule14Browser(chromium,output,env){
 const root=path.resolve('output/playwright/M4-14',path.basename(path.resolve(output))),profile=path.join(root,'profile'),artifacts=path.join(root,'artifacts');mkdirSync(profile,{recursive:true});mkdirSync(artifacts,{recursive:true});
 const context=await chromium.launchPersistentContext(profile,{headless:true,artifactsDir:artifacts,executablePath:env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??path.join(env.LOCALAPPDATA,'ms-playwright/chromium-1208/chrome-win64/chrome.exe')});const browser=context.browser();assert.ok(browser);return browser;
}
