const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null
});

const validationQueue = new Queue('link-validation', { connection });

// Schedule cron job every 5 minutes to queue pending links
const schedulePendingValidation = async (prisma) => {
    try {
        const pendingLinks = await prisma.productLink.findMany({
            where: { status: 'pending' },
            select: { id: true, url: true }
        });

        for (const link of pendingLinks) {
            await validationQueue.add('validate_link', {
                linkId: link.id,
                url: link.url
            });
        }

        console.log(`Queued ${pendingLinks.length} pending links for validation`);
    } catch (error) {
        console.error('Schedule error:', error);
    }
};

module.exports = { validationQueue, schedulePendingValidation, connection };
