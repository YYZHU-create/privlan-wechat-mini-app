/* Read computed geometry, not merely the presence of a CSS declaration. */
function auditPhoneLayout(doc) {
 const screen=doc.querySelector('.phone-canvas.mobile .mobile-page');
 if(!screen || !screen.clientWidth || !screen.clientHeight)return {status:'NOT_VERIFIED',reason:'mobile screen missing or hidden'};
 const scroll=screen.querySelector('.mobile-scroll'),status=screen.querySelector('.mobile-status'),tab=screen.querySelector('.mobile-tabbar');
 if(!scroll||!status)return {status:'FAIL',reason:'required screen regions missing'};
 const win=doc.defaultView;const tabHeight=tab?tab.getBoundingClientRect().height/(screen.getBoundingClientRect().width/screen.clientWidth):0;
 const reserved=tab?tabHeight:parseFloat(win.getComputedStyle(screen.closest('.phone-canvas')).getPropertyValue('--phone-bottom-inset'));
 const expected=screen.clientHeight-status.clientHeight-reserved;
 const checks={screenBounded:screen.scrollWidth<=screen.clientWidth+1,contentHeight:Math.abs(scroll.clientHeight-expected)<=2,verticalScroll:['auto','scroll'].includes(win.getComputedStyle(scroll).overflowY),tabSafety:!tab||parseFloat(win.getComputedStyle(tab).paddingBottom)>=20};
 return {status:Object.values(checks).every(Boolean)?'PASS':'FAIL',screen:[screen.clientWidth,screen.clientHeight],content:scroll.clientHeight,expected,checks};
}
if(typeof module!=='undefined')module.exports={auditPhoneLayout};
