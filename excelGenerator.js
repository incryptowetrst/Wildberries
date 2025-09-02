class ExcelGenerator {
    constructor() {
        if (typeof XLSX === 'undefined') {
            throw new Error('SheetJS library not loaded');
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
            
            // Формируем данные для Excel
            const excelData = data.map((item, index) => ({
                '№': index + 1, // Порядковый номер
                'Артикул': item.article,
                'Цена кошелька': this.parsePrice(item.result.walletPrice),
                'Старая цена': this.parsePrice(item.result.oldPrice),
                'Финальная цена': this.parsePrice(item.result.finalPrice),
                'URL': `https://www.wildberries.ru/catalog/${item.article}/detail.aspx`,
                'Статус': item.result.success ? 'Успешно' : 
                         (item.result.captcha ? 'Капча' : 'Ошибка'),
                'Попыток': item.attempts,
                'Ошибка': item.result.error || '',
                'Дата выгрузки': reportDate.date,
                'Время выгрузки': reportDate.time
            }));
            
            const worksheet = XLSX.utils.json_to_sheet(excelData);
            XLSX.utils.book_append_sheet(workbook, worksheet, "Wildberries");
            
            // Генерируем бинарные данные Excel
            const excelBuffer = XLSX.write(workbook, {
                bookType: 'xlsx',
                type: 'array'
            });
            
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
        
        // Пытаемся извлечь числовое значение
        const numericValue = parseFloat(priceStr.replace(/[^\d.,]/g, '').replace(',', '.'));
        return isNaN(numericValue) ? priceStr : numericValue;
    }
}

window.ExcelGenerator = ExcelGenerator;