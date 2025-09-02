// offscreen.js остается без изменений
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'parseUrls') {
    parseUrls(request.urls).then(sendResponse);
    return true;
  }
});

async function parseUrls(urls) {
  const results = [];
  for (const url of urls) {
    try {
      const result = await getPrices(url);
      results.push(result);
    } catch (error) {
      results.push({
        url,
        walletPrice: 'ошибка',
        oldPrice: 'ошибка',
        finalPrice: 'ошибка',
        error: error.message
      });
    }
  }
  return results;
}

function decodeWindows1251(buffer) {
  const decoder = new TextDecoder('windows-1251');
  return decoder.decode(buffer);
}

async function getPrices(url) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const html = decodeWindows1251(buffer);
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Попробуем найти JSON-данные о товаре
  const jsonScript = doc.getElementById('__NEXT_DATA__');
  if (jsonScript) {
    try {
      const data = JSON.parse(jsonScript.textContent);
      const productData = data.props?.initialState?.product?.data?.products?.[0];
      
      if (productData) {
        const formatPrice = (price) => {
          if (!price) return 'не найдено';
          return (price / 100).toFixed(2) + ' руб';
        };
        
        return {
          url,
          walletPrice: formatPrice(productData.salePriceU),
          oldPrice: formatPrice(productData.priceU),
          finalPrice: formatPrice(productData.salePriceU)
        };
      }
    } catch (e) {
      console.error('Ошибка парсинга JSON:', e);
    }
  }
  
  // Если JSON не найден, попробуем найти цены в HTML
  const cleanPrice = (price) => {
    if (!price) return 'не найдено';
    return price.replace(/\s+/g, ' ').trim();
  };
  
  const oldPriceElem = doc.querySelector('del.price-block__old-price span') || 
                      doc.querySelector('span.old-price');
  
  const finalPriceElem = doc.querySelector('ins.price-block__final-price') || 
                         doc.querySelector('.in-price');
  
  const walletPriceElem = doc.querySelector('span.price-block__wallet-price') || 
                         doc.querySelector('span.wallet-price');
  
  return {
    url,
    walletPrice: cleanPrice(walletPriceElem?.textContent),
    oldPrice: cleanPrice(oldPriceElem?.textContent),
    finalPrice: cleanPrice(finalPriceElem?.textContent)
  };
}