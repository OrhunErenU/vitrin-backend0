const axios = require('axios');
const cheerio = require('cheerio');
const { PrismaClient } = require('@prisma/client');
const { validationQueue, connection } = require('./queue');
const blacklist = require('../config/blacklist');

const prisma = new PrismaClient();

const validateLink = async (job) => {
    const { linkId, url } = job.data;
    console.log(`Validating: ${url}`);

    try {
        // Extract domain
        const domain = new URL(url).hostname;

        // Check blacklist
        if (blacklist.some(bad => domain.includes(bad))) {
            await prisma.productLink.update({
                where: { id: linkId },
                data: { status: 'invalid', isValid: false, metadata: { error: 'Domain blacklisted' } }
            });
            return { valid: false, reason: 'blacklisted' };
        }

        // HEAD request with timeout and redirects
        const response = await axios.head(url, {
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: () => true
        });

        if (response.status !== 200) {
            await prisma.productLink.update({
                where: { id: linkId },
                data: { status: 'invalid', isValid: false, metadata: { error: `HTTP ${response.status}` } }
            });
            return { valid: false, reason: 'non_200' };
        }

        // Check content type
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
            await prisma.productLink.update({
                where: { id: linkId },
                data: { status: 'invalid', isValid: false, metadata: { error: 'Not HTML' } }
            });
            return { valid: false, reason: 'not_html' };
        }

        // Fetch full page for parsing
        const html = await axios.get(url, { timeout: 10000 });
        const $ = cheerio.load(html.data);

        // Extract metadata
        const title = $('meta[property="og:title"]').attr('content') || $('title').text() || null;
        const image = $('meta[property="og:image"]').attr('content') || null;

        // Price extraction (meta or regex)
        let price = $('meta[property="product:price"]').attr('content') || null;
        if (!price) {
            const priceMatch = html.data.match(/["\'](?:[$€£₺]?\s?\d+[.,]\d{2})["\']/);
            price = priceMatch ? priceMatch[0].replace(/["\']/g, '') : null;
        }

        await prisma.productLink.update({
            where: { id: linkId },
            data: {
                status: 'valid',
                isValid: true,
                domain,
                metadata: {
                    title,
                    image,
                    price,
                    validatedAt: new Date().toISOString()
                }
            }
        });

        return { valid: true, title, image, price };
    } catch (error) {
        await prisma.productLink.update({
            where: { id: linkId },
            data: { status: 'invalid', isValid: false, metadata: { error: error.message } }
        });
        return { valid: false, reason: error.message };
    }
};

// Start worker
const worker = new Worker('link-validation', validateLink, { connection, concurrency: 5 });

worker.on('completed', job => {
    console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed:`, err.message);
});

module.exports = { validateLink, worker };
