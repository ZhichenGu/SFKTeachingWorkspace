/* Supabase transport + compact data boundary. Store text and active signatures
 * only, never the complete A4 image. Students use a scoped expiring token.
 */
'use strict';
window.SFKCloud = (() => {
  const config=window.SFK_CONFIG||{},MAX_IMAGE=16*1024;
  const configured=!!(config.supabaseUrl&&config.supabasePublishableKey);
  const url=(config.supabaseUrl||'').replace(/\/$/,'');
  async function request(path,{method='GET',body}={}){
    if(!configured)throw Error('请先按 README 配置 Supabase，才能保存云端记录和接收学生签名。');
    const headers={apikey:config.supabasePublishableKey,'Content-Type':'application/json'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{const response=await fetch(url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});const data=await response.json().catch(()=>null);if(!response.ok)throw Error(data?.message||data?.msg||data?.error_description||'请求失败，请检查网络和项目配置。');return data;}catch(error){if(error.name==='AbortError')throw Error('请求超时，请检查网络后重试。');throw error;}finally{clearTimeout(timer);}
  }
  const rpc=(name,body)=>request('/rest/v1/rpc/'+name,{method:'POST',body});
  const bytes=data=>Math.floor((data.split(',')[1]||'').length*3/4);
  async function smallImage(source){
    const img=new Image();img.src=source;await img.decode();
    for(const width of [600,480,360,280]){
      const scale=Math.min(1,width/img.width,200/img.height),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
      const png=c.toDataURL('image/png');if(bytes(png)<=MAX_IMAGE)return png;
      for(const quality of [.85,.7,.55,.4]){const jpeg=c.toDataURL('image/jpeg',quality);if(bytes(jpeg)<=MAX_IMAGE)return jpeg;}
    }
    throw Error('签名图片无法在保持可读尺寸时压缩到 16 KB，请裁去多余背景后重试。');
  }
  async function compactSignature(s){
    const clean=blankSignature();if(s.loading)throw Error('签名图片仍在处理，请稍后重试。');
    if(s.mode==='text'){if(!(s.text||'').trim())return clean;const c=document.createElement('canvas');c.width=560;c.height=200;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,560,200);x.fillStyle='#111';x.textAlign='center';x.textBaseline='middle';x.font='italic '+Math.max(40,Math.min(120,Math.floor(520/Math.max(1,Array.from(s.text).length))))+'px '+handFont;x.fillText(s.text,280,100);clean.mode='image';clean.text=s.text;clean.image=await smallImage(c.toDataURL('image/png'));return clean;}if(!signaturePresent(s))return clean;clean.mode='image';
    if(s.mode==='image')clean.image=bytes(s.image)<=MAX_IMAGE?s.image:await smallImage(s.image);
    else{const c=document.createElement('canvas');c.width=600;c.height=300;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,600,300);ctx.strokeStyle='#111';ctx.fillStyle='#111';ctx.lineWidth=3.4;ctx.lineCap='round';ctx.lineJoin='round';s.strokes.forEach(points=>{ctx.beginPath();if(points.length===1){ctx.arc(points[0][0]*600,points[0][1]*300,1.7,0,Math.PI*2);ctx.fill();}else{points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p[0]*600,p[1]*300));ctx.stroke();}});clean.image=await smallImage(c.toDataURL('image/png'));}return clean;
  }
  async function compactRecord(record){const clone=JSON.parse(JSON.stringify(record));clone.signatures={student:await compactSignature(clone.signatures.student),mentor:await compactSignature(clone.signatures.mentor)};if(new TextEncoder().encode(JSON.stringify(clone)).length>80000)throw Error('记录内容过大，请缩短文字后重试。');return clone;}
  function cleanRecord(raw){
    if(!raw||typeof raw!=='object')throw Error('记录格式不正确。');const clean=initialRecord(),limits={studentName:80,courseName:120,lessonDate:10,lessonNumber:3,checkIn:5,checkOut:5,content:12000,homework:12000,teacherName:24};if(typeof raw.teacherName!=='string')raw.teacherName=(raw.signatures&&raw.signatures.mentor&&raw.signatures.mentor.text)||'';
    for(const [key,max] of Object.entries(limits)){if(typeof raw[key]!=='string'||raw[key].length>max)throw Error('记录字段不正确。');clean[key]=raw[key];}
    for(const [key,label] of [['checkIn','开始时间'],['checkOut','结束时间']]){if(clean[key]&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean[key]))throw Error(label+'格式不正确，请使用 HH:MM');}
    if(!['项目课','基础/软件课'].includes(clean.courseName)||![null,'yes','no'].includes(raw.previousHomework))throw Error('记录选项不正确。');clean.previousHomework=raw.previousHomework;
    for(const role of ['mentor','student']){const s=raw.signatures?.[role],sig=blankSignature();if(!s||!['text','image'].includes(s.mode))throw Error('签名格式不正确。');sig.mode=s.mode;if(s.mode==='text'){if(typeof s.text!=='string'||s.text.length>24)throw Error('姓名签名格式不正确。');sig.text=s.text;}if(s.mode==='image'&&s.image){if(typeof s.image!=='string'||s.image.length>23000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(s.image))throw Error('图片签名格式不正确。');sig.image=s.image;}if(typeof s.text==='string'&&s.text.length<=24)sig.text=s.text;clean.signatures[role]=sig;}return clean;
  }
  return {configured,compactSignature,compactRecord,cleanRecord,
    async list(teacherId){const rows=[];const filter=teacherId?('&teacher_id=eq.'+encodeURIComponent(teacherId)):'';for(let offset=0;;offset+=1000){const page=await request('/rest/v1/lesson_records?select=id,student_name,teacher_name,lesson_date,check_in,course_name,signed_at,revision,updated_at'+filter+'&order=lesson_date.desc,check_in.desc,id&limit=1000&offset='+offset);rows.push(...page);if(page.length<1000)return rows;}},
    async get(id){const rows=await request('/rest/v1/lesson_records?id=eq.'+encodeURIComponent(id)+'&select=id,record,revision,signed_at,updated_at,share_token,share_expires_at');if(!rows?.length)throw Error('没有找到这份签单。');rows[0].published=!!(rows[0].share_token&&new Date(rows[0].share_expires_at)>new Date());rows[0].record=cleanRecord(rows[0].record);return rows[0];},
    save:(id,revision,record,teacherId)=>rpc('save_lesson',{p_id:id,p_expected_revision:revision,p_record:record,p_teacher_id:teacherId||null}),
    remove:id=>rpc('delete_lesson',{p_id:id}),
    publish:id=>rpc('publish_lesson',{p_id:id}),getShared:token=>rpc('get_shared_lesson',{p_token:token}),submit:(token,signature)=>rpc('submit_lesson_signature',{p_token:token,p_signature:signature}),
    async listTeachers(){const rows=await request('/rest/v1/teachers?select=id,name&order=name');return rows;},
    addTeacher:name=>rpc('add_teacher',{p_name:name}),
    async ocrSchedule(image){if(!configured)throw Error('请先按 README 配置 Supabase。');const res=await fetch(url+'/functions/v1/ocr-schedule',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey},body:JSON.stringify({image})});const data=await res.json().catch(()=>null);if(!res.ok)throw Error(data?.error||'OCR 调用失败，请重试。');return data;}};
})();
