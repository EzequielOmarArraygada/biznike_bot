const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs').promises;

async function actualizarBeneficios() {
    let browser;
    try {
        console.log('Iniciando extracción con Puppeteer...');
        
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://pdb.com.ar', { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('a[href="/beneficios"]', { timeout: 10000 }); 
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
            page.click('a[href="/beneficios"]')
        ]);

        await page.waitForSelector('article', { timeout: 30000 });

        const content = await page.content();
        const $ = cheerio.load(content);
        
        const beneficios = [];

        // Iteramos por cada sección de la página para obtener su zona geográfica
        $('section').each((index, sectionElement) => {
            const section = $(sectionElement);
            
            // Capturamos el texto del primer encabezado/div de la sección (ej. "A M B A")
            let zonaRaw = section.find('h2, h3, div, p').first().text().trim();
            
            // Si el texto viene con letras separadas ("A M B A" -> "AMBA", "M E N D O Z A" -> "MENDOZA")
            // Si no hay texto, por defecto se asigna 'GENERAL / ONLINE'
            let zona = zonaRaw ? zonaRaw.replace(/\s+/g, '') : 'GENERAL / ONLINE';

            // Iteramos sobre los artículos dentro de ESTA sección
            section.find('article').each((i, element) => {
                const article = $(element);
                
                const titulo = article.find('h3').text().trim();
                const descripcion = article.find('h3').next('p').text().trim();
                
                let imagenUrl = null;
                const imgSrc = article.find('img').attr('src');
                if (imgSrc) {
                    imagenUrl = imgSrc.startsWith('http') ? imgSrc : `https://pdb.com.ar${imgSrc}`;
                }

                let codigoDescuento = null;
                const textoCompleto = article.text();
                const matchCodigo = textoCompleto.match(/CÓDIGO:\s*([A-Z0-9]+)/i);
                if (matchCodigo) {
                    codigoDescuento = matchCodigo[1].trim();
                }

                const enlaces = [];
                article.find('a').each((_, a) => {
                    const href = $(a).attr('href');
                    if (href && !href.startsWith('javascript')) enlaces.push(href);
                });

                if (titulo) {
                    beneficios.push({
                        zona,
                        titulo,
                        descripcion,
                        imagenUrl,
                        codigoDescuento,
                        enlaces
                    });
                }
            });
        });

        await fs.writeFile('beneficios.json', JSON.stringify(beneficios, null, 2), 'utf-8');
        console.log(`✅ Extracción completada. Se guardaron ${beneficios.length} beneficios con su zona geográfica.`);

    } catch (error) {
        console.error('❌ Error durante el scraping:', error.message);
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { actualizarBeneficios };
