const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.WORKFLOW_TEST_SOURCE||path.resolve(__dirname,'../public/app.js'),'utf8');
test('merchant navigation and rendering do not expose Workflow',()=>{assert.doesNotMatch(source,/\bworkflow\b/i);});
test('old Workflow URL resolves to overview while existing destinations remain valid',()=>{const decl=source.match(/const mvpViews = new Set\([^;]+;/)[0];for(const view of ['workflow','overview','products','marketing','appointments']){const value=vm.runInNewContext(decl+'const requestedView='+JSON.stringify(view)+';mvpViews.has(requestedView)?requestedView:"overview";');assert.equal(value,view==='workflow'?'overview':view);}});
test('removed view cannot be reopened through switchView',()=>{assert.match(source,/if \(!mvpViews\.has\(id\) \|\| mvpFeatureFlags\[id\] === false\) id = "overview"/);});
