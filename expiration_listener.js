const Redis = require('ioredis');

// Separate Redis connection needed for pub/sub subscriptions
const redisSubscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

function initExpirationListener(db, io) {
  // Subscribe to Redis expired keyspace events
  redisSubscriber.psubscribe('__keyevent@0__:expired', (err) => {
    if (err) console.error('Failed to subscribe to Redis expired events:', err);
    else console.log('Redis TTL Expiration Listener running...');
  });

  redisSubscriber.on('pmessage', async (pattern, channel, expiredKey) => {
    // Target keys formatted as: hold:{showId}:{seatId}
    if (expiredKey.startsWith('hold:')) {
      const parts = expiredKey.split(':');
      const showId = parts[1];
      const seatId = parts[2];

      try {
        // 1. Revert seat status in PostgreSQL IF it was not booked
        const result = await db.query(
          `UPDATE show_seats 
           SET status = 'AVAILABLE', held_by = NULL 
           WHERE id = $1 AND show_id = $2 AND status = 'HELD'
           RETURNING id`,
          [seatId, showId]
        );

        // 2. Broadcast real-time update to all clients looking at the seat map
        if (result.rowCount > 0) {
          io.to(`show_${showId}`).emit('seat_status_changed', {
            seatId: parseInt(seatId, 10),
            status: 'AVAILABLE',
            heldBy: null,
          });
          console.log(`Seat ${seatId} for show ${showId} auto-released on TTL expiry.`);
        }
      } catch (error) {
        console.error(`Error auto-releasing seat ${seatId}:`, error);
      }
    }
  });
}

module.exports = initExpirationListener;
