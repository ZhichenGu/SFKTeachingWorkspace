/* Shared A4 rasterization; ZIP uses stored entries (PNG is already compressed).
 * UTF-8 names, CRC32 and standard ZIP headers; no CDN or private fonts.
 */
'use strict';
window.SFKExports=(()=>{
 async function png(record){await document.fonts.ready;const doc=renderDocument(record);if(doc.overflow.length)throw Error(doc.overflow.join('、')+'超出 A4 容量，请编辑后再下载');const url=URL.createObjectURL(new Blob([doc.svg],{type:'image/svg+xml;charset=utf-8'}));try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=1588;canvas.height=2246;canvas.getContext('2d').drawImage(image,0,0,1588,2246);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片生成失败');return blob;}finally{URL.revokeObjectURL(url);}}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
 function header(length){const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);return {bytes,u16:(p,v)=>view.setUint16(p,v,true),u32:(p,v)=>view.setUint32(p,v,true)};}
 function zip(files){
  if(files.length>65535)throw Error('一次选择的文件过多，请分批下载');
  const local=[],central=[];let offset=0,centralSize=0;
  for(const file of files){const name=new TextEncoder().encode(file.name),data=file.data,crc=crc32(data),h=header(30);h.u32(0,0x04034b50);h.u16(4,20);h.u16(6,0x800);h.u16(12,33);h.u32(14,crc);h.u32(18,data.length);h.u32(22,data.length);h.u16(26,name.length);local.push(h.bytes,name,data);
   const c=header(46);c.u32(0,0x02014b50);c.u16(4,20);c.u16(6,20);c.u16(8,0x800);c.u16(14,33);c.u32(16,crc);c.u32(20,data.length);c.u32(24,data.length);c.u16(28,name.length);c.u32(42,offset);central.push(c.bytes,name);centralSize+=46+name.length;offset+=30+name.length+data.length;
   if(offset+centralSize>0xffffffff)throw Error('图片总量超过 ZIP 容量，请分批下载');
  }
  const end=header(22);end.u32(0,0x06054b50);end.u16(8,files.length);end.u16(10,files.length);end.u32(12,centralSize);end.u32(16,offset);return new Blob([...local,...central,end.bytes],{type:'application/zip'});
 }
 return {png,download,zip};
})();
