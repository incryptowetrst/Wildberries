const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');

async function getPrices(url) {
    let options = new chrome.Options();
    options.addArguments('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    options.addArguments('--disable-blink-features=AutomationControlled');

    let driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    try {
        await driver.get(url);
        console.log(`Страница ${url} загружена. Ищем цены...`);

        // Прокрутка страницы для загрузки контента
        await driver.executeScript("window.scrollTo(0, document.body.scrollHeight);");
        await driver.sleep(2000);

        async function findElementBySelectors(selectors) {
            for (let selector of selectors) {
                try {
                    let element = await driver.wait(
                        until.elementLocated(By.css(selector)),
                        30000
                    );
                    return element;
                } catch (e) {
                    continue;
                }
            }
            return null;
        }

        const oldPriceSelectors = ['del.price-block__old-price span', 'span.old-price'];
        const finalPriceSelectors = ['ins.price-block__final-price', ' in-price'];
        const walletPriceSelectors = ['span.price-block__wallet-price', 'span.wallet-price'];

        let oldPriceElement = await findElementBySelectors(oldPriceSelectors);
        let oldPrice = oldPriceElement ? await oldPriceElement.getText() : "Старая цена не найдена";

        let finalPriceElement = await findElementBySelectors(finalPriceSelectors);
        let finalPrice = finalPriceElement ? await finalPriceElement.getText() : "Финальная цена не найдена";

        let walletPriceElement = await findElementBySelectors(walletPriceSelectors);
        let walletPrice = walletPriceElement ? await walletPriceElement.getText() : "Цена кошелька не найдена";

        const cleanPrice = (price) => price.replace(/\s+/g, ' ').trim();

        oldPrice = cleanPrice(oldPrice);
        finalPrice = cleanPrice(finalPrice);
        walletPrice = cleanPrice(walletPrice);

        console.log(`Найденная цена кошелька для ${url}:`, walletPrice);
        console.log(`Найденная старая цена для ${url}:`, oldPrice);
        console.log(`Найденная финальная цена для ${url}:`, finalPrice);

        return { url, walletPrice, oldPrice, finalPrice };

    } catch (e) {
        console.log(`Ошибка при обработке ${url}: ${e}`);
        fs.writeFileSync(`page_source_${url.replace(/[^a-z0-9]/gi, '_')}.html`, await driver.getPageSource());
        await driver.takeScreenshot().then((image) =>
            fs.writeFileSync(`debug_screenshot_${url.replace(/[^a-z0-9]/gi, '_')}.png`, image, 'base64')
        );
        return {
            url,
            walletPrice: "Цена кошелька не найдена",
            oldPrice: "Старая цена не найдена",
            finalPrice: "Финальная цена не найдена",
            error: e.message
        };
    } finally {
        await driver.quit();
    }
}

async function getPricesForMultipleUrls(urls) {
    const results = [];
    for (const url of urls) {
        const result = await getPrices(url);
        results.push(result);
    }
    return results;
}

// Запускаем парсер при старте
(async () => {
    let urls = [
        'https://www.wildberries.ru/catalog/413190914/detail.aspx',
        'https://www.wildberries.ru/catalog/146173622/detail.aspx'
    ];
    let results = await getPricesForMultipleUrls(urls);
    results.forEach(result => {
        console.log(`URL: ${result.url}`);
        console.log(`Цена кошелька: ${result.walletPrice}`);
        console.log(`Старая цена: ${result.oldPrice}`);
        console.log(`Финальная цена: ${result.finalPrice}`);
        if (result.error) console.log(`Ошибка: ${result.error}`);
        console.log('---');
    });
})();