// OCR via Google Cloud Vision DOCUMENT_TEXT_DETECTION.
// Deploy: supabase functions deploy ocr-schedule --project-ref <ref>
// Secret:  GOOGLE_VISION_API_KEY  (Supabase dashboard -> Edge Functions -> Secrets)
// The frontend only calls this function; it never holds the Google credential.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function flattenWords(annotation) {
  const words = [];
  const pages = (annotation && annotation.pages) || [];
  for (const page of pages) {
    for (const block of page.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const word of para.words || []) {
          const text = (word.symbols || []).map((s) => s.text || '').join('');
          if (!text.trim()) continue;
          const vs = (word.boundingBox && word.boundingBox.vertices) || [];
          if (!vs.length) { words.push({ text, x: 0, y: 0, w: 0, h: 0 }); continue; }
          const xs = vs.map((v) => v.x || 0), ys = vs.map((v) => v.y || 0);
          const x = Math.min(...xs), y = Math.min(...ys);
          words.push({ text, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
        }
      }
    }
  }
  return words;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST 请求' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.image) throw new Error('缺少图片');
    const source = String(body.image);
    if (!/^data:image\/(?:jpeg|png);base64,/i.test(source)) {
      throw new Error('仅支持 JPG / PNG 图片');
    }
    const image = source.replace(/^data:image\/[a-z+]+;base64,/i, '');
    // 10 MB binary ~= 13.4 MB Base64. Reject before forwarding to Google.
    if (!image || image.length > 14_000_000 || !/^[A-Za-z0-9+/]+=*$/.test(image)) {
      throw new Error('图片无效或超过 10 MB');
    }
    const key = Deno.env.get('GOOGLE_VISION_API_KEY');
    if (!key) throw new Error('OCR 尚未配置（缺少 GOOGLE_VISION_API_KEY Secret）');
    const resp = await fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ image: { content: image }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }],
        }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) throw new Error((data && data.error && data.error.message) || 'Google Vision 调用失败');
    const result = data.responses && data.responses[0];
    if (result && result.error) throw new Error(result.error.message || 'Google Vision 未能识别图片');
    const ann = result && result.fullTextAnnotation;
    return new Response(
      JSON.stringify({ text: (ann && ann.text) || '', words: flattenWords(ann) }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || 'OCR 失败' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
