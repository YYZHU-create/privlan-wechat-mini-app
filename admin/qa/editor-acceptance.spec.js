const {test,expect}=require('@playwright/test');const {auditPhoneLayout}=require('./phone-layout-audit');
test('editor title save reload and generation through UI',async({page})=>{
 await page.goto('/?view=editor');const block=page.locator('.page-section').filter({has:page.locator('.product-preview-grid')}).first();await block.scrollIntoViewIfNeeded();await block.locator('h3').click();
 const title='验收商品标题';await page.getByLabel('商品区块标题',{exact:true}).fill(title);await expect(block.locator('h3')).toHaveText(title);
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/config')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存当前更改',exact:true}).click();expect((await saved).status()).toBe(200);
 await page.reload();await expect(page.locator('.product-section h3').first()).toHaveText(title);
 const synced=page.waitForResponse(r=>r.url().endsWith('/api/sync')&&r.request().method()==='POST');await page.getByRole('button',{name:'生成预览',exact:true}).click();const response=await synced;expect(response.status()).toBe(200);expect((await response.json()).ok).toBe(true);
});
for(const width of [1440,1024,952,768])test('computed phone layout '+width,async({page})=>{await page.setViewportSize({width,height:1000});await page.goto('/?view=editor');await expect(page.locator('.mobile-page')).toBeVisible();const result=await page.evaluate(`(${auditPhoneLayout.toString()})(document)`);expect(result.status,JSON.stringify(result)).toBe('PASS');});

test('desktop viewport and horizontal drag distinguish click from movement',async({page})=>{
 await page.goto('/?view=editor');await page.getByRole('button',{name:'桌面预览',exact:true}).click();await expect(page.locator('.phone-canvas.desktop')).toBeVisible();expect(await page.locator('.phone-canvas.desktop').evaluate(e=>[e.clientWidth,e.clientHeight])).toEqual([1920,1080]);
 await page.getByRole('button',{name:'手机预览',exact:true}).click();const block=page.locator('.page-section').filter({has:page.locator('.product-preview-grid')}).first();await block.scrollIntoViewIfNeeded();await block.locator('h3').click();await page.getByLabel('商品布局',{exact:true}).selectOption('horizontal');const strip=block.locator('.product-preview-grid');await strip.scrollIntoViewIfNeeded();const box=await strip.boundingBox();
 await page.mouse.move(box.x+box.width-20,box.y+40);await page.mouse.down();await page.mouse.move(box.x+20,box.y+40,{steps:12});await page.mouse.up();expect(await strip.evaluate(e=>e.scrollLeft)).toBeGreaterThan(50);await expect(page.getByLabel('当前编辑页面',{exact:true})).toHaveValue('home');
 await page.waitForTimeout(450);await strip.locator('.product-card').last().click();await expect(page.getByLabel('当前编辑页面',{exact:true})).toHaveValue('detail');
});
