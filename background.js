// Импортируем библиотеку для работы с Excel
try {
  importScripts('lib/xlsx.full.min.js');
} catch (e) {
  console.error('Не удалось загрузить библиотеку SheetJS');
}

// Глобальные переменные для управления состоянием
let jobState = {
  isRunning: false,
  articles: [],
  proxies: [],
  settings: {},
  results: [],
  log: [],
  progress: { current: 0, total: 1 }
};

const proxySessions = new Map();
const proxyCache = new Map();

// Основной слушатель сообщений
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const actions = {
    startParsing: () => startParsing(request.data),
    exportToExcel: () => exportToExcel(),
    getStatus: () => sendStateToPopup(),
    clearSession: () => resetState(),
    checkProxies: () => checkProxies(request.data.proxies).then(sendResponse),
    parseUrl: () => parseWildberries(request.url, request.proxy, request.attempt || 1).then(sendResponse)
  };

  if (actions[request.action]) {
    actions[request.action]();
  }
  
  return true;
});

// Функции управления состоянием
function sendStateToPopup() {
  chrome.runtime.sendMessage({ action: 'stateUpdate', state: jobState });
}

function resetState() {
  jobState = {
    isRunning: false,
    articles: [],
    proxies: [],
    settings: {},
    results: [],
    log: [{ message: 'Поля очищены. Введите новые данные.', type: 'info' }],
    progress: { current: 0, total: 1 }
  };
  proxyCache.clear();
  sendStateToPopup();
}

function logProgress(message, type = 'info') {
  const logEntry = { message, type };
  jobState.log.push(logEntry);
  chrome.runtime.sendMessage({ action: 'logMessage', logEntry });
}

function updateProgress(current, total) {
  jobState.progress = { current, total };
  chrome.runtime.sendMessage({ action: 'updateProgress', progress: jobState.progress });
}

// Функция проверки прокси
async function checkProxies(proxies) {
  logProgress('Начало проверки прокси...', 'info');
  
  const workingProxies = [];
  
  for (const proxyStr of proxies) {
    const [host, port, username, password] = proxyStr.split(':');
    const proxyConfig = { host, port: parseInt(port), username, password };
    
    logProgress(`Проверка прокси ${host}:${port}...`, 'warning');
    const isWorking = await testProxy(proxyConfig);
    
    if (isWorking) {
      workingProxies.push(proxyStr);
      logProgress(`Прокси ${host}:${port} рабочий`, 'success');
    } else {
      logProgress(`Прокси ${host}:${port} не работает`, 'error');
    }
  }
  
  return {
    totalCount: proxies.length,
    workingCount: workingProxies.length,
    workingProxies: workingProxies
  };
}

// Функция проверки работоспособности прокси через Wildberries
async function testProxy(proxyConfig) {
  const cacheKey = `${proxyConfig.host}:${proxyConfig.port}:${proxyConfig.username}:${proxyConfig.password}`;
  
  // Проверяем кэш
  if (proxyCache.has(cacheKey)) {
    return proxyCache.get(cacheKey);
  }

  return new Promise(async (resolve) => {
    let sessionId;
    let tab;
    
    try {
      sessionId = `${Date.now()}-test-${Math.random().toString(36).substr(2, 5)}`;
      
      // Устанавливаем прокси
      await applyProxySettings(sessionId, proxyConfig);
      
      // Используем тестовый URL Wildberries вместо httpbin.org
      tab = await chrome.tabs.create({
        url: 'https://www.wildberries.ru/catalog/123456/detail.aspx', // тестовый артикул
        active: false
      });
      
      proxySessions.set(sessionId, tab.id);
      
      // Таймаут 5 секунд для Wildberries
      const timeout = setTimeout(async () => {
        proxyCache.set(cacheKey, false);
        resolve(false);
        if (tab?.id) await chrome.tabs.remove(tab.id);
        if (sessionId) proxySessions.delete(sessionId);
        await clearProxySettings();
      }, 5000);
      
      // Слушаем завершение загрузки
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          
          // Проверяем, что мы на странице Wildberries (даже если это 404)
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              return {
                isWb: document.title.includes('Wildberries') || 
                      window.location.hostname.includes('wildberries'),
                url: window.location.href
              };
            }
          }).then((result) => {
            const isWorking = result[0].result.isWb;
            proxyCache.set(cacheKey, isWorking);
            resolve(isWorking);
          }).catch(() => {
            proxyCache.set(cacheKey, false);
            resolve(false);
          }).finally(async () => {
            if (tab?.id) await chrome.tabs.remove(tab.id);
            if (sessionId) proxySessions.delete(sessionId);
            await clearProxySettings();
          });
        }
      });
    } catch (error) {
      proxyCache.set(cacheKey, false);
      resolve(false);
      if (tab?.id) await chrome.tabs.remove(tab.id);
      if (sessionId) proxySessions.delete(sessionId);
      await clearProxySettings();
    }
  });
}

// Функция для принудительного использования прокси
async function ensureProxyUsage(sessionId, proxyConfig) {
  return new Promise((resolve) => {
    // Устанавливаем прокси настройки
    chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            host: proxyConfig.host,
            port: proxyConfig.port,
            scheme: "http"
          },
          bypassList: ["localhost", "127.0.0.1"]
        }
      },
      scope: "regular"
    }, resolve);
    
    // Добавляем обработчик для аутентификации
    const authListener = function(details) {
      if (proxySessions.get(sessionId)) {
        return {
          authCredentials: {
            username: proxyConfig.username,
            password: proxyConfig.password
          }
        };
      }
    };
    
    chrome.webRequest.onAuthRequired.addListener(
      authListener,
      { urls: ["<all_urls>"] },
      ['blocking']
    );
  });
}

// Основная функция парсинга
async function startParsing(data) {
  if (jobState.isRunning) {
    logProgress('Парсинг уже запущен.', 'error');
    return;
  }

  jobState = {
    ...jobState,
    isRunning: true,
    articles: data.articles,
    proxies: data.proxies,
    settings: data.settings,
    results: new Array(data.articles.length).fill(null),
    log: [],
    progress: { current: 0, total: data.articles.length }
  };

  logProgress('Начало парсинга...', 'info');
  sendStateToPopup();

  const { articles, proxies, settings } = jobState;
  const { maxAttempts, maxThreads, checkProxies } = settings;
  const urls = articles.map(article => `https://www.wildberries.ru/catalog/${article}/detail.aspx`);
  
  let proxyIndex = 0;
  let processedCount = 0;

  let workingProxies = proxies;
  
  // Проверяем прокси перед началом работы, если включена опция
  if (checkProxies) {
    logProgress('Проверка работоспособности прокси через Wildberries...', 'info');
    const proxyCheckResult = await checkProxies(proxies);
    
    if (proxyCheckResult.workingCount === 0) {
      logProgress('Нет рабочих прокси для Wildberries. Парсинг остановлен.', 'error');
      jobState.isRunning = false;
      sendStateToPopup();
      return;
    }
    
    workingProxies = proxyCheckResult.workingProxies;
    logProgress(`Найдено рабочих прокси: ${workingProxies.length}/${proxies.length}`, 'success');
  } else {
    logProgress('Проверка прокси отключена. Используются все предоставленные прокси.', 'warning');
  }

  // Обработка одного артикула
  const processArticle = async (index) => {
    const article = articles[index];
    const url = urls[index];
    logProgress(`Обработка товара ${index + 1}/${articles.length}`, 'info');

    let attempt = 1;
    let result = null;

    while (attempt <= maxAttempts) {
      // Используем только рабочие прокси (если проверка была) или все прокси
      const proxyStr = workingProxies[proxyIndex % workingProxies.length];
      const [host, port, username, password] = proxyStr.split(':');
      const proxyConfig = { host, port: parseInt(port), username, password };
      proxyIndex++;

      logProgress(`Попытка ${attempt}: прокси ${proxyConfig.host}`, 'warning');
      result = await parseWildberries(url, proxyConfig, attempt);

      if (result.success) {
        logProgress('Успешно получены цены!', 'success');
        break;
      }
      
      if (result.captcha) logProgress(`Обнаружена капча: ${result.captcha}`, 'error');
      if (result.redirect) {
        logProgress(`Перенаправление: ${result.redirect}`, 'error');
        break;
      }

      if (attempt < maxAttempts) {
        const delay = 2000 + Math.random() * 3000;
        logProgress(`Пауза ${Math.round(delay/1000)} сек.`, 'warning');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      attempt++;
    }

    const finalResult = { article, result, attempts: attempt, originalIndex: index };
    jobState.results[index] = finalResult;
    processedCount++;
    updateProgress(processedCount, articles.length);

    chrome.runtime.sendMessage({ action: 'newResult', item: finalResult });
  };

  // Последовательная обработка с задержками
  for (let i = 0; i < articles.length; i++) {
    await processArticle(i);
    
    // Добавляем задержку между запросами
    if (i < articles.length - 1) {
      const delay = 1000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  logProgress('Парсинг завершен', 'success');
  jobState.isRunning = false;
  updateProgress(articles.length, articles.length);
  sendStateToPopup();

  if (settings.autoExport) {
    await exportToExcel();
  }
}

// Функция парсинга отдельного URL
async function parseWildberries(url, proxyConfig, attempt) {
  return new Promise(async (resolve) => {
    let sessionId;
    let tab;
    
    try {
      // Создаем уникальный идентификатор сессии
      sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      
      // Устанавливаем прокси для этой сессии
      await ensureProxyUsage(sessionId, proxyConfig);
      
      // Создаем новую вкладку в фоновом режиме
      tab = await chrome.tabs.create({
        url: url,
        active: false
      });
      
      // Сохраняем связь сессии с вкладкой
      proxySessions.set(sessionId, tab.id);
      
      // Ожидаем полной загрузки
      await waitForFullPageLoad(tab.id);
      
      // Проверяем корректность URL после загрузки
      const currentTab = await new Promise(resolve => 
        chrome.tabs.get(tab.id, resolve)
      );
      
      // Проверяем, что мы на нужной странице
      if (!currentTab.url.includes('/catalog/') || 
          currentTab.url.includes('/career/') ||
          currentTab.url.includes('/travel/') ||
          currentTab.url.includes('/services/')) {
        throw new Error(`Перенаправление на: ${currentTab.url}`);
      }
      
      // Рандомная задержка перед действиями (3-8 секунд)
      await randomDelay(3000, 8000);
      
      // Выполняем "человеческие" действия
      await performHumanActions(tab.id);
      
      // Дополнительная задержка после действий (2-5 секунд)
      await randomDelay(2000, 5000);
      
      // Проверяем наличие капчи
      const captchaCheck = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: detectCaptcha,
      });
      
      if (captchaCheck[0].result.isCaptcha) {
        return resolve({
          url,
          success: false,
          walletPrice: 'капча',
          oldPrice: 'требуется',
          finalPrice: 'вмешательство',
          captcha: captchaCheck[0].result.type,
          error: 'Обнаружена капча',
          attempt
        });
      }
      
      // Выполняем скрипт для извлечения цен
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPrices,
      });
      
      // Проверяем результат
      const prices = result[0].result;
      const success = prices.walletPrice !== 'не найдено' && 
                     prices.walletPrice !== 'ошибка';
      
      resolve({
        ...prices,
        success,
        attempt
      });
      
    } catch (error) {
      // Определяем тип ошибки
      let errorType = 'ошибка';
      if (error.message.includes('Перенаправление')) {
        errorType = 'редирект';
      }
      
      resolve({
        url,
        success: false,
        walletPrice: errorType,
        oldPrice: errorType,
        finalPrice: errorType,
        error: error.message,
        redirect: error.message.includes('Перенаправление') ? error.message : null,
        attempt
      });
    } finally {
      // Закрываем вкладку при ошибке
      if (tab?.id) await chrome.tabs.remove(tab.id);
      if (sessionId) proxySessions.delete(sessionId);
      await clearProxySettings();
    }
  });
}

// Генерация Excel
async function exportToExcel() {
  const dataToExport = jobState.results.filter(r => r);
  if (dataToExport.length === 0) {
    logProgress('Нет данных для экспорта', 'error');
    return;
  }

  logProgress('Формирование Excel файла...', 'info');

  try {
    const excelGenerator = new ExcelGenerator();
    const { buffer, fileName } = await excelGenerator.generate(dataToExport);
    
    // Преобразуем ArrayBuffer в base64
    const base64Data = arrayBufferToBase64(buffer);
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64Data}`;
    
    // Скачиваем файл через chrome.downloads API
    chrome.downloads.download({
      url: dataUrl,
      filename: fileName,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        logProgress(`Ошибка скачивания: ${chrome.runtime.lastError.message}`, 'error');
      } else {
        logProgress(`Файл ${fileName} успешно скачан!`, 'success');
      }
    });

  } catch (error) {
    logProgress(`Ошибка при экспорте: ${error.message}`, 'error');
  }
}

// Функция для преобразования ArrayBuffer в base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Класс ExcelGenerator
class ExcelGenerator {
  constructor() {
    if (typeof XLSX === 'undefined') {
      throw new Error('Библиотека SheetJS не загружена');
    }
  }

  async generate(data, fileName = 'wildberries_prices') {
    try {
      const workbook = XLSX.utils.book_new();
      const now = new Date();
      const reportDate = {
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString()
      };

      const excelData = data.map((item, index) => ({
        '№': index + 1,
        'Артикул': item.article,
        'Цена кошелька': this.parsePrice(item.result.walletPrice),
        'Старая цена': this.parsePrice(item.result.oldPrice),
        'Финальная цена': this.parsePrice(item.result.finalPrice),
        'URL': `https://www.wildberries.ru/catalog/${item.article}/detail.aspx`,
        'Статус': item.result.success ? 'Успешно' : (item.result.captcha ? 'Капча' : 'Ошибка'),
        'Попыток': item.attempts,
        'Ошибка': item.result.error || '',
        'Дата выгрузки': reportDate.date,
        'Время выгрузки': reportDate.time
      }));

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Wildberries");

      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

      return {
        buffer: excelBuffer,
        fileName: `${fileName}_${now.getTime()}.xlsx`
      };
    } catch (error) {
      throw new Error(`Ошибка генерации Excel: ${error.message}`);
    }
  }

  parsePrice(priceStr) {
    if (!priceStr) return null;
    const numericValue = parseFloat(priceStr.replace(/[^\d.,]/g, '').replace(',', '.'));
    return isNaN(numericValue) ? priceStr : numericValue;
  }
}

// Вспомогательные функции для парсинга
async function applyProxySettings(sessionId, proxyConfig) {
  return new Promise((resolve) => {
    const authListener = function(details) {
      if (proxySessions.get(sessionId)) {
        return {
          authCredentials: {
            username: proxyConfig.username,
            password: proxyConfig.password
          }
        };
      }
    };
    
    chrome.webRequest.onAuthRequired.addListener(
      authListener,
      { urls: ["<all_urls>"] },
      ['blocking']
    );
    
    chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            host: proxyConfig.host,
            port: proxyConfig.port,
            scheme: "http"
          },
          bypassList: ["localhost", "127.0.0.1"]
        }
      },
      scope: "regular"
    }, resolve);
  });
}

async function clearProxySettings() {
  return new Promise((resolve) => {
    chrome.proxy.settings.clear({}, resolve);
  });
}

async function waitForFullPageLoad(tabId) {
  return new Promise(async (resolve) => {
    await new Promise(resolve => chrome.tabs.onUpdated.addListener(
      function listener(tabIdLocal, changeInfo) {
        if (tabIdLocal === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
    ));

    await randomDelay(2000, 4000);

    const isReady = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const wbLoader = document.querySelector('.loading');
        const reactRoot = document.getElementById('app');
        return {
          ready: document.readyState === 'complete',
          loaderHidden: wbLoader ? wbLoader.style.display === 'none' : true,
          contentVisible: reactRoot?.children?.length > 0
        };
      }
    });

    const { ready, loaderHidden, contentVisible } = isReady[0].result;

    if (!(ready && loaderHidden && contentVisible)) {
      await randomDelay(3000, 6000);
    }

    resolve();
  });
}

async function randomDelay(minMs, maxMs) {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function performHumanActions(tabId) {
  const actionsCount = 2 + Math.floor(Math.random() * 4);
  
  for (let i = 0; i < actionsCount; i++) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const actionType = Math.floor(Math.random() * 3);
        const documentHeight = document.body.scrollHeight;
        
        if (actionType < 2) {
          const scrollTo = Math.random() * documentHeight * 0.7 + documentHeight * 0.3;
          window.scrollTo({
            top: scrollTo,
            behavior: 'smooth'
          });
        } else {
          const clickX = Math.random() * window.innerWidth;
          const clickY = Math.random() * window.innerHeight;
          
          const element = document.elementFromPoint(clickX, clickY);
          if (element) {
            const event = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            element.dispatchEvent(event);
          }
        }
      }
    });
    
    await randomDelay(1000, 3000);
  }
  
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.scrollTo({ top: 0, behavior: 'smooth' })
  });
}

function detectCaptcha() {
  const captchaSelectors = [
    '#captcha-form', 
    '.CheckboxCaptcha',
    'iframe[src*="captcha"]',
    'div.captcha',
    'div#recaptcha'
  ];
  
  for (const selector of captchaSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      return {
        isCaptcha: true,
        type: selector
      };
    }
  }
  
  return { isCaptcha: false };
}

function extractPrices() {
  if (!window.location.href.includes('/catalog/') || 
      window.location.href.includes('/career/') ||
      window.location.href.includes('/travel/') ||
      window.location.href.includes('/services/')) {
    return {
      error: 'Некорректная страница',
      walletPrice: 'редирект',
      oldPrice: 'редирект',
      finalPrice: 'редирект',
      redirect: window.location.href
    };
  }
  
  const findElement = (selectors) => {
    for (let selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  };
  
  // ОБНОВЛЕННЫЕ СЕЛЕКТОРЫ ДЛЯ НОВОЙ ВЕРСТКИ WILDBERRIES
  const oldPriceSelectors = [
    'del.priceBlockOldPrice--qSWAf span', // Новый селектор для старой цены
    'del[class*="priceBlockOldPrice"] span', // На случай изменений
    'del.price-block__old-price span', // Старый селектор (fallback)
    'span.old-price',
    'span[data-link*="priceOld"]',
    '.price-block__old-price',
    '.j-final-saving',
    'span[class*="old"]',
    'del[class*="price"]'
  ];
  
  const finalPriceSelectors = [
    'ins.priceBlockFinalPrice--iToZR', // Новый селектор для финальной цены
    'ins[class*="priceBlockFinalPrice"]', // На случай изменений
    'ins.price-block__final-price', // Старый селектор (fallback)
    '.in-price',
    'span[data-link*="priceNow"]',
    '.price-block__final-price',
    '.final-price',
    'span[class*="final"]',
    'span[class*="current"]'
  ];
  
  const walletPriceSelectors = [
    'span.priceBlockWalletPrice--RJGuT', // Новый селектор для цены кошелька
    'span[class*="priceBlockWalletPrice"]', // На случай изменений
    'span.price-block__wallet-price', // Старый селектор (fallback)
    'span.wallet-price',
    'span[data-link*="walletPrice"]',
    '.wallet-price',
    '.bonus-amount',
    'span[class*="wallet"]',
    'span[class*="bonus"]'
  ];
  
  const oldPriceElem = findElement(oldPriceSelectors);
  const finalPriceElem = findElement(finalPriceSelectors);
  const walletPriceElem = findElement(walletPriceSelectors);
  
  const cleanPrice = (elem) => {
    if (!elem) return 'не найдено';
    
    let text = elem.textContent
      .replace(/\s+/g, ' ')
      .replace(/\u2009/g, '')  // Удаляем тонкие пробелы
      .replace(/\u00a0/g, '')  // Удаляем неразрывные пробелы
      .trim();
    
    // Удаляем знак рубля и лишние пробелы
    return text.replace(/\s*₽$/, '').trim();
  };
  
  let walletPrice = cleanPrice(walletPriceElem);
  if (walletPrice === 'не найдено') {
    const priceElements = document.querySelectorAll('[class*="price"], [class*="amount"]');
    for (const element of priceElements) {
      const text = element.textContent.toLowerCase();
      if (text.includes('кошелек') || text.includes('wallet')) {
        walletPrice = cleanPrice(element);
        break;
      }
    }
  }
  
  return {
    url: window.location.href,
    walletPrice: walletPrice,
    oldPrice: cleanPrice(oldPriceElem),
    finalPrice: cleanPrice(finalPriceElem)
  };
}