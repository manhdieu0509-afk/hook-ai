export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const { url } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chưa cấu hình API key' });

  // ── BƯỚC 1: Fetch trang TikTok từ phía server ──
  let productInfo = null;
  try {
    // Resolve shortened URL nếu là vt.tiktok.com
    let finalUrl = url;
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
      finalUrl = headRes.url;
      const html = await headRes.text();

      // Extract từ HTML
      const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.replace(/ \| TikTok.*$/i, '').trim();
      const desc = (html.match(/<meta[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']{10,})/i) ||
                   html.match(/content=["']([^"']{10,})["'][^>]*(?:name|property)=["'](?:description|og:description)/i) || [])[1];
      const price = (html.match(/["'](?:price|currentPrice|salePrice)["']\s*[:\s]+["']?(\d[\d.,]+)/i) ||
                    html.match(/(\d{2,3}[.,]\d{3})\s*(?:đ|₫|VND)/i) || [])[1];
      const image = (html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i) ||
                    html.match(/content=["']([^"']+)["'][^>]*property=["']og:image/i) || [])[1];

      if (title && title.length > 3) {
        productInfo = { title, desc: desc || title, price: price ? price + 'đ' : null, image, url: finalUrl };
      }
    } catch (e) { /* ignore fetch error */ }

    // Nếu không lấy được từ HTML, dùng Claude để phân tích URL trực tiếp
    if (!productInfo) {
      productInfo = { title: null, desc: null, price: null, url: finalUrl };
    }
  } catch(e) {
    productInfo = { title: null, desc: null, price: null, url };
  }

  // ── BƯỚC 2: Claude phân tích + viết hook ──
  const prompt = productInfo.title
    ? `Bạn là chuyên gia marketing TikTok Shop Việt Nam.

THÔNG TIN SẢN PHẨM (đọc từ TikTok Shop):
- Tên: ${productInfo.title}
- Mô tả: ${productInfo.desc || productInfo.title}
- Giá: ${productInfo.price || 'chưa rõ'}
- Link: ${productInfo.url}

Phân tích và viết hook. Trả về JSON hợp lệ duy nhất (không markdown, không backtick):
{"productName":"...","productSummary":"...","segments":[{"title":"...","desc":"..."},{"title":"...","desc":"..."},{"title":"...","desc":"..."}],"painPoints":["...","...","...","...","..."],"hooks":[{"type":"...","text":"...","why":"..."},{"type":"...","text":"...","why":"..."},{"type":"...","text":"...","why":"..."},{"type":"...","text":"...","why":"..."},{"type":"...","text":"...","why":"..."}]}

RULES:
- productName: tên sản phẩm ngắn gọn
- productSummary: tóm tắt 1 câu về sản phẩm
- segments: 3 nhóm khách hàng mục tiêu cụ thể
- painPoints: 5 nỗi đau thực tế của khách hàng
- hooks: 5 câu mở đầu video (8-18 chữ), tiếng Việt TỰ NHIÊN, VIRAL, đa dạng phong cách (tò mò, nỗi đau, sốc, social proof, khẩn cấp)`
    : `Bạn là chuyên gia marketing TikTok Shop Việt Nam.

Link sản phẩm: ${url}

Dựa vào URL này, hãy suy luận về sản phẩm và viết hook. Trả về JSON hợp lệ duy nhất:
{"productName":"Sản phẩm TikTok Shop","productSummary":"Sản phẩm được bán trên TikTok Shop","segments":[{"title":"Khách hàng quan tâm","desc":"Người dùng TikTok đang tìm kiếm sản phẩm tốt với giá hợp lý"}],"painPoints":["Khó tìm sản phẩm chất lượng","Sợ hàng kém chất lượng"],"hooks":[{"type":"Gây tò mò","text":"Sản phẩm này đang viral trên TikTok vì lý do này!","why":"Kích thích sự tò mò"},{"type":"Social proof","text":"Hàng ngàn người đã mua và review 5 sao!","why":"Tạo niềm tin"},{"type":"Nỗi đau","text":"Bạn vẫn chưa thử sản phẩm này sao?","why":"Tạo FOMO"},{"type":"Khẩn cấp","text":"Flash sale hôm nay - số lượng có hạn!","why":"Tạo khẩn cấp"},{"type":"Gây sốc","text":"Giá rẻ đến mức không tin được!","why":"Thu hút sự chú ý"}]}

CHỈ trả về JSON nếu không đọc được link.`;

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
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    const raw = (aiData.content || []).map(i => i.text || '').join('');
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    return res.status(200).json({
      success: true,
      productInfo: {
        name: parsed.productName || productInfo.title || 'Sản phẩm TikTok Shop',
        summary: parsed.productSummary || '',
        price: productInfo.price,
        image: productInfo.image,
        fetchedFromLink: !!productInfo.title,
      },
      segments: parsed.segments,
      painPoints: parsed.painPoints,
      hooks: parsed.hooks,
    });

  } catch(e) {
    return res.status(500).json({ error: 'Lỗi xử lý: ' + e.message });
  }
}
