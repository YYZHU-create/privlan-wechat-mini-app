const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const net=require('node:net');const {spawn}=require('node:child_process');
test('isolated HTTP save, reload and generated titles/layout agree',{timeout:60000},async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'feeldao-acceptance-'));const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const child=spawn(process.execPath,[path.resolve(__dirname,'../../scripts/local-editor.cjs')],{env:{...process.env,LOCAL_EDITOR_HOME:home,LOCAL_EDITOR_PORT:String(port)},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}`;
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/config')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(ready,true,'isolated editor ready');
  const cfg=await(await fetch(base+'/api/config')).json();const block=cfg.pageLayouts.home.find(b=>b.type==='product-grid');assert.ok(block);
  const title='验收商品标题 & 保存一致';block.props.title=title;block.props.layout='horizontal';block.props.itemsPerView=2;cfg.tabBar.items[1].text='验收分类';
  const post=async(url,data)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify(data)});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));assert.equal(result.ok,true);return result;};
  await post('/api/config',cfg);const loaded=await(await fetch(base+'/api/config')).json();assert.equal(loaded.pageLayouts.home.find(b=>b.type==='product-grid').props.title,title);assert.equal(loaded.tabBar.items[1].text,'验收分类');
  await post('/api/sync',{});const root=path.join(home,'project');const xml=fs.readFileSync(path.join(root,'pages/home/home.wxml'),'utf8');assert.ok(xml.includes('验收商品标题 &amp; 保存一致'));assert.ok(xml.includes('builder-product-scroll'));const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));assert.equal(app.tabBar.list[1].text,'验收分类');
 }finally{if(process.platform==='win32'){try{require('node:child_process').execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}else child.kill(); /* Isolated diagnostics remain outside user configuration. */}
});
