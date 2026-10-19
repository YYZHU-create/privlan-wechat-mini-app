const {test}=require('node:test');const assert=require('node:assert/strict');const {auditPhoneLayout}=require('../qa/phone-layout-audit');
test('phone audit refuses missing or hidden screen',()=>{assert.equal(auditPhoneLayout({querySelector:()=>null}).status,'NOT_VERIFIED');assert.equal(auditPhoneLayout({querySelector:()=>({clientWidth:0})}).status,'NOT_VERIFIED');});
test('computed audit catches later layout override despite source rules',()=>{
 const scroll={clientHeight:729};const tab={getBoundingClientRect:()=>({height:83})};const status={clientHeight:62};const screen={clientWidth:402,clientHeight:874,scrollWidth:402,querySelector:s=>s==='.mobile-scroll'?scroll:s==='.mobile-status'?status:tab,getBoundingClientRect:()=>({width:402}),closest:()=>({})};
 const doc={querySelector:()=>screen,defaultView:{getComputedStyle:el=>el===scroll?{overflowY:'auto'}:{paddingBottom:'34px'}}};assert.equal(auditPhoneLayout(doc).status,'PASS');scroll.clientHeight=844;assert.equal(auditPhoneLayout(doc).status,'FAIL');scroll.clientHeight=729;screen.scrollWidth=500;assert.equal(auditPhoneLayout(doc).status,'FAIL');
});
