document.addEventListener('DOMContentLoaded', () => {
  // Элементы UI
  const startBtn = document.getElementById('startBtn');
  const clearBtn = document.getElementById('clearBtn');
  const exportBtn = document.getElementById('exportBtn');
  const checkProxiesBtn = document.getElementById('checkProxiesBtn');
  const articlesTextarea = document.getElementById('articles');
  const proxiesTextarea = document.getElementById('proxies');
  const progressDiv = document.getElementById('progress');
  const resultsDiv = document.getElementById('results');
  const progressBar = document.getElementById('progressBar');
  const globalCounter = document.getElementById('globalCounter');
  const example1 = document.getElementById('example1');
  const example2 = document.getElementById('example2');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const enableProxyCheck = document.getElementById('enableProxyCheck');
  const proxyStatus = document.getElementById('proxyStatus');

  // Инициализация
  exportBtn.disabled = true;
  globalCounter.style.display = 'none';
  proxyStatus.style.display = 'none';

  // Примеры артикулов
  const exampleArticles = {
    example1: ['413190914', '146173622'],
    example2: ['188806365', '188806365']
  };

  // Прокси по умолчанию
  proxiesTextarea.value = `178.250.185.165:3000:nsT1mK:CBlTTstzHC
109.107.160.165:3000:nsT1mK:CBlTTstzHC
45.88.148.230:3000:nsT1mK:CBlTTstzHC
45.88.149.133:3000:nsT1mK:CBlTTstzHC
92.119.42.223:3000:nsT1mK:CBlTTstzHC
45.142.253.28:3000:nsT1mK:CBlTTstzHC
95.182.124.159:3000:nsT1mK:CBlTTstzHC
188.130.143.181:3000:nsT1mK:CBlTTstzHC
188.130.189.22:3000:nsT1mK:CBlTTstzHC
46.8.213.7:3000:nsT1mK:CBlTTstzHC
45.93.15.222:62622:XB5nWSGi:HJutf9ux
176.103.91.108:62604:XB5nWSGi:HJutf9ux
46.150.252.135:62516:XB5nWSGi:HJutf9ux
46.150.244.68:64738:XB5nWSGi:HJutf9ux
85.142.1.242:63998:XB5nWSGi:HJutf9ux
85.142.2.39:63456:XB5nWSGi:HJutf9ux
85.142.48.156:63786:XB5nWSGi:HJutf9ux
85.142.49.78:63156:XB5nWSGi:HJutf9ux
85.142.50.168:64688:XB5nWSGi:HJutf9ux
85.142.131.112:64670:XB5nWSGi:HJutf9ux`;

  // Обработчики для примеров артикулов
  example1.addEventListener('click', () => {
    articlesTextarea.value = exampleArticles.example1.join('\n');
  });

  example2.addEventListener('click', () => {
    articlesTextarea.value = exampleArticles.example2.join('\n');
  });

  // Очистка полей ввода
  clearBtn.addEventListener('click', () => {
    articlesTextarea.value = '';
    proxiesTextarea.value = '';
    resultsDiv.innerHTML = '';
    progressDiv.innerHTML = '<div>Поля очищены. Введите новые данные.</div>';
    progressBar.style.width = '0%';
    fileList.innerHTML = '';
    globalCounter.style.display = 'none';
    proxyStatus.style.display = 'none';
    
    chrome.runtime.sendMessage({ action: 'clearSession' });
  });

  // Функции UI
  function logProgress(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.textContent = message;
    logEntry.className = type;
    progressDiv.appendChild(logEntry);
    progressDiv.scrollTop = progressDiv.scrollHeight;
  }

  function updateProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    progressBar.style.width = `${percent}%`;
    globalCounter.textContent = `Обработано: ${current}/${total}`;
    globalCounter.style.display = 'block';
  }

  function createResultItem(index, article, result, attempt = 1) {
    const url = `https://www.wildberries.ru/catalog/${article}/detail.aspx`;
    const itemDiv = document.createElement('div');
    itemDiv.className = 'item';
    
    const isSuccess = result.walletPrice !== 'не найдено' && result.walletPrice !== 'ошибка';
    const status = isSuccess ? '✅' : '❌';
    
    itemDiv.innerHTML = `
      <strong>${status} Товар ${index + 1}:</strong>
      <span class="attempt-badge">попытка ${attempt}</span><br>
      <div>Артикул: ${article} <a href="${url}" target="_blank" class="article-link">(открыть)</a></div>
      <strong>Цена кошелька:</strong> ${result.walletPrice}<br>
      <strong>Старая цена:</strong> ${result.oldPrice}<br>
      <strong>Финальная цена:</strong> ${result.finalPrice}
      ${result.error ? `<div class="error">Ошибка: ${result.error}</div>` : ''}
      ${result.captcha ? `<div class="warning">Обнаружена капча: ${result.captcha}</div>` : ''}
      ${result.redirect ? `<div class="warning">Перенаправление: ${result.redirect}</div>` : ''}
    `;
    return itemDiv;
  }

  // Обработка загрузки файла
  function handleFileUpload(file) {
    if (file.type !== 'text/plain') {
      logProgress('Ошибка: Файл должен быть в формате TXT', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const content = e.target.result;
      articlesTextarea.value = content;
      
      fileList.innerHTML = `
        <div class="file-item">
          <span>${file.name} (${Math.round(file.size / 1024)} KB)</span>
          <span class="remove-file" title="Удалить файл">×</span>
        </div>
      `;
      
      document.querySelector('.remove-file').addEventListener('click', () => {
        fileList.innerHTML = '';
        articlesTextarea.value = '';
      });
      
      logProgress(`Файл "${file.name}" успешно загружен!`, 'success');
    };
    reader.readAsText(file);
  }

  // Drag and Drop обработчики
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, highlight, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, unhighlight, false);
  });

  function highlight() {
    dropZone.classList.add('dragover');
  }

  function unhighlight() {
    dropZone.classList.remove('dragover');
  }

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const file = dt.files[0];
    if (file) {
      handleFileUpload(file);
    }
  });

  // Кнопка проверки прокси
  checkProxiesBtn.addEventListener('click', () => {
    const proxies = proxiesTextarea.value.trim().split('\n')
      .map(proxy => proxy.trim())
      .filter(proxy => proxy.split(':').length === 4);

    if (proxies.length === 0) {
      logProgress('Ошибка: Заполните поле прокси', 'error');
      return;
    }

    checkProxiesBtn.disabled = true;
    checkProxiesBtn.textContent = "Проверка...";
    proxyStatus.style.display = 'none';

    chrome.runtime.sendMessage({ 
      action: 'checkProxies', 
      data: { proxies } 
    });
  });

  // Обработчики событий
  startBtn.addEventListener('click', () => {
    const articles = articlesTextarea.value.trim().split('\n')
      .map(article => article.replace(/\D/g, ''))
      .filter(article => article.length >= 7 && article.length <= 9);
    
    const proxies = proxiesTextarea.value.trim().split('\n')
      .map(proxy => proxy.trim())
      .filter(proxy => proxy.split(':').length === 4);

    if (articles.length === 0 || proxies.length === 0) {
      logProgress('Ошибка: Заполните поля артикулов и прокси', 'error');
      return;
    }

    const settings = {
      maxAttempts: parseInt(document.getElementById('maxRetries').value) || 3,
      autoExport: document.getElementById('autoExport').checked,
      checkProxies: document.getElementById('enableProxyCheck').checked,
      maxThreads: 1 // Обрабатываем последовательно
    };
    
    startBtn.disabled = true;
    startBtn.textContent = "Запуск...";
    resultsDiv.innerHTML = '';
    progressDiv.innerHTML = '';

    chrome.runtime.sendMessage({ 
      action: 'startParsing', 
      data: { articles, proxies, settings } 
    });
  });

  exportBtn.addEventListener('click', () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Формирование...';
    chrome.runtime.sendMessage({ action: 'exportToExcel' });
  });

  // Слушатель сообщений от background.js
  chrome.runtime.onMessage.addListener((request) => {
    switch (request.action) {
      case 'stateUpdate':
        renderState(request.state);
        break;
      case 'logMessage':
        logProgress(request.logEntry.message, request.logEntry.type);
        break;
      case 'updateProgress':
        updateProgress(request.progress.current, request.progress.total);
        break;
      case 'newResult':
        const item = request.item;
        const itemDiv = createResultItem(item.originalIndex, item.article, item.result, item.attempts);
        resultsDiv.appendChild(itemDiv);
        itemDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        break;
      case 'proxyCheckResult':
        checkProxiesBtn.disabled = false;
        checkProxiesBtn.textContent = "Проверить прокси";
        
        proxyStatus.style.display = 'block';
        if (request.result.workingCount > 0) {
          proxyStatus.className = 'proxy-status proxy-working';
          proxyStatus.innerHTML = `
            Рабочих прокси: <strong>${request.result.workingCount}/${request.result.totalCount}</strong><br>
            Список рабочих: ${request.result.workingProxies.join(', ')}
          `;
        } else {
          proxyStatus.className = 'proxy-status proxy-failed';
          proxyStatus.innerHTML = `
            Рабочих прокси не найдено: <strong>0/${request.result.totalCount}</strong><br>
            Проверьте настройки прокси или отключите проверку
          `;
        }
        break;
    }
  });

  function renderState(state) {
    resultsDiv.innerHTML = '';
    state.log.forEach(log => logProgress(log.message, log.type));
    state.results.forEach(item => {
      if (item) {
        const itemDiv = createResultItem(item.originalIndex, item.article, item.result, item.attempts);
        resultsDiv.appendChild(itemDiv);
      }
    });
    
    updateProgress(state.progress.current, state.progress.total);
    startBtn.disabled = state.isRunning;
    checkProxiesBtn.disabled = state.isRunning;
    clearBtn.disabled = state.isRunning;
    exportBtn.disabled = state.isRunning || state.results.filter(r => r).length === 0;
    startBtn.textContent = state.isRunning ? "Парсинг в процессе..." : "Запустить парсинг";
    
    if (!state.isRunning && state.results.filter(r => r).length > 0) {
      exportBtn.textContent = "Выгрузить в Excel";
      exportBtn.disabled = false;
    }
  }

  // Запрос текущего состояния при загрузке
  chrome.runtime.sendMessage({ action: 'getStatus' });
});