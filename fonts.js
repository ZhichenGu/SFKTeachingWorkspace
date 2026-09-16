/* Self-hosted fixed body font so measurement and export don't depend on the
 * device having Kaiti/Songti installed. OFL-licensed subset, see fonts/OFL.txt.
 */
'use strict';
window.SFKFonts=(()=>{
  const family='SFK Serif SC',url='fonts/NotoSerifSC-subset.woff2';
  const style=document.createElement('style');
  style.textContent='@font-face{font-family:"SFK Serif SC";src:url("'+url+'") format("woff2");font-weight:400;font-style:normal;font-display:swap}';
  document.head.append(style);
  let ready=Promise.resolve();
  try{ready=document.fonts.load('400 16px "SFK Serif SC"').then(()=>{}).catch(()=>{});}catch{}
  ready.then(()=>{if(typeof render==='function')render();});
  return {family,ready};
})();
