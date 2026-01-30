const { Worker } = require('bullmq');
const Redis = require('ioredis');
const axios = require('axios');
const cheerio = require('cheerio');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Redis bağlantısı (Render Redis URL)
const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// Blacklist (geçici hardcoded, ileride config'den çekilebilir)
const BLACKLIST = ['scam.com', 'fake.net', 'phishing.org'];

// Link doğrulama fonksiyonu
async function validateLinkProcessor(job) {
  const { linkId, url } = job.data;
  
  console.log(`Validating: ${url}`);
  
  try {
    // URL parse et
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    
    // Blacklist kontrolü
    if (BLACKLIST.some(bad => domain.includes(bad))) {
      await prisma.productLink.update({
        where: { id: linkId },
        data: { 
          status: 'invalid',
          metadata: { error: 'Domain blacklisted' }
        }
      });
      return { status: 'invalid', reason: 'blacklist' };
    }
    
    // HTTP isteği (HEAD yerine GET, çünkü bazı siteler HEAD'e izin vermiyor)
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    // HTML parse
    const $ = cheerio.load(response.data);
    const title = $('meta[property="og:title"]').attr('content') || 
                  $('meta[name="title"]').attr('content') || 
                  $('title').text() || 
                  'Unknown Product';
                  
    const image = $('meta[property="og:image"]').attr('content') || 
                  $('meta[name="twitter:image"]').attr('content') || 
                  '';
                  
    const price = $('meta[property="product:price:amount"]').attr('content') || 
                  $('meta[property="og:price:amount"]').attr('content') || 
                  $('.price, .product-price, [class*="price"]').first().text().trim() || 
                  '';
    
    // Veritabanını güncelle
    await prisma.productLink.update({
      where: { id: linkId },
      data: {
        status: 'valid',
        isValid: true,
        domain: domain,
        metadata: {
          title: title.substring(0, 200),
          image: image.substring(0, 500),
          price: price.substring(0, 50),
          validatedAt: new Date().toISOString()
        }
      }
    });
    
    console.log(`✓ Valid: ${domain} - ${title}`);
    return { status: 'valid', domain, title };
    
  } catch (error) {
    console.error(`✗ Invalid: ${url} - ${error.message}`);
    
    await prisma.productLink.update({
      where: { id: linkId },
      data: {
        status: 'invalid',
        isValid: false,
        metadata: { 
          error: error.message,
          validatedAt: new Date().toISOString()
        }
      }
    });
    
    return { status: 'invalid', error: error.message };
  }
}

// Worker oluştur (BullMQ Worker class'ı import edildi!)
const worker = new Worker('link-validation', validateLinkProcessor, {
  connection,
  concurrency: 3,
  limiter: {
    max: 10,
    duration: 1000
  }
});

// Event listeners
worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

console.log('🚀 Link Validator Worker started...');
console.log('📡 Connected to Redis:', process.env.REDIS_URL ? 'YES' : 'NO');

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
