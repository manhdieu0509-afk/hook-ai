export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const { url } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chưa cấu hình API key' });

  // ── BƯỚC 1: Fetch trang TikTok từ phía server ──
  let productInfo = { title: null, desc: null, price: null, image: null, url };

  try {
    const headRes = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    const finalUrl = headRes.url;
    const html = await headRes.text();

    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.replace(/ \| TikTok.*$/i, '').trim();
    const desc = (
      html.match(/<meta[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']{10,})/i) ||
      html.match(/content=["']([^"']{10,})["'][^>]*(?:name|property)=["'](?:description|og:description)/i)
    || [])[1];
    const price = (
      html.match(/["'](?:price|currentPrice|salePrice)["']\s*[:\s]+["']?(\d[\d.,]+)/i) ||
      html.match(/(\d{2,3}[.,]\d{3})\s*(?:đ|₫|VND)/i)
    || [])[1];
    const image = (
      html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i) ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:image/i)
    || [])[1];

    if (title && title.length > 3) {
      productInfo = { title, desc: desc || title, price: price ? price + 'đ' : null, image, url: finalUrl };
    }
  } catch (e) { /* tiếp tục dù không fetch được */ }

  // ── BƯỚC 2: Claude phân tích + viết hook ──
  const prompt = `Bạn là chuyên gia marketing TikTok Shop Việt Nam hàng đầu.

${productInfo.title ? `THÔNG TIN SẢN PHẨM:
- Tên: ${productInfo.title}
- Mô tả: ${productInfo.desc || productInfo.title}
- Giá: ${productInfo.price || 'chưa rõ'}` : `Link sản phẩm TikTok Shop: ${url}
Hãy suy luận thông tin sản phẩm từ link này.`}

Nhiệm vụ: Phân tích tệp khách hàng và viết 5 hook viral.

Trả về JSON hợp lệ (KHÔNG markdown, KHÔNG backtick, KHÔNG text thừa):
{
  "productName": "tên ngắn gọn",
  "productSummary": "tóm tắt 1 câu",
  "segments": [
    {"title": "nhóm 1", "desc": "mô tả ngắn"},
    {"title": "nhóm 2", "desc": "mô tả ngắn"},
    {"title": "nhóm 3", "desc": "mô tả ngắn"}
  ],
  "painPoints": ["nỗi đau 1", "nỗi đau 2", "nỗi đau 3", "nỗi đau 4", "nỗi đau 5"],
  "hooks": [
    {"type": "Gây tò mò", "text": "câu hook ngắn 8-15 chữ", "why": "lý do 1 câu"},
    {"type": "Nỗi đau", "text": "câu hook ngắn 8-15 chữ", "why": "lý do 1 câu"},
    {"type": "Gây sốc", "text": "câu hook ngắn 8-15 chữ", "why": "lý do 1 câu"},
    {"type": "Social proof", "text": "câu hook ngắn 8-15 chữ", "why": "lý do 1 câu"},
    {"type": "Khẩn cấp", "text": "câu hook ngắn 8-15 chữ", "why": "lý do 1 câu"}
  ]
}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();

    if (aiData.error) {
      return res.status(500).json({ error: 'Lỗi API: ' + aiData.error.message });
    }

    const raw = (aiData.content || []).map(i => i.text || '').join('').trim();

    // Tìm JSON trong response (dù có text thừa)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI không trả về JSON hợp lệ' });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return res.status(200).json({
      success: true,
      productInfo: {
        name: parsed.productName || productInfo.title || 'Sản phẩm TikTok Shop',
        summary: parsed.productSummary || '',
        price: productInfo.price,
        image: productInfo.image,
        fetchedFromLink: !!productInfo.title,
      },
      segments: parsed.segments || [],
      painPoints: parsed.painPoints || [],
      hooks: parsed.hooks || [],
    });

  } catch (e) {
    return res.status(500).json({ error: 'Lỗi xử lý: ' + e.message });
  }
}
