import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

// Establish socket connection (Adjust URL for your backend)
const socket = io(process.env.REACT_APP_API_URL || 'http://localhost:5000');

const HOLD_TTL_SECONDS = 600; // 10 minutes

export default function InteractiveSeatMap({ showId, userId, categoryPrices }) {
  const [seats, setSeats] = useState([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [holdTimer, setHoldTimer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 1. Fetch initial seat layout & listen for socket updates
  useEffect(() => {
    fetchSeats();

    // Join show-specific room for real-time seat updates
    socket.emit('join_show_room', { showId });

    socket.on('seat_status_changed', ({ seatId, status, heldBy }) => {
      setSeats((prevSeats) =>
        prevSeats.map((seat) =>
          seat.id === seatId ? { ...seat, status, heldBy } : seat
        )
      );
    });

    return () => {
      socket.off('seat_status_changed');
      socket.emit('leave_show_room', { showId });
    };
  }, [showId]);

  // 2. Countdown timer for seat hold auto-release
  useEffect(() => {
    let interval = null;
    if (holdTimer > 0) {
      interval = setInterval(() => setHoldTimer((t) => t - 1), 1000);
    } else if (holdTimer === 0) {
      clearInterval(interval);
      setSelectedSeatIds([]);
      setError('Hold expired. Your selected seats have been released.');
      fetchSeats(); // Refresh map
    }
    return () => clearInterval(interval);
  }, [holdTimer]);

  const fetchSeats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/shows/${showId}/seats`);
      const data = await res.json();
      setSeats(data.seats);
    } catch (err) {
      setError('Failed to load seat layout');
    } finally {
      setLoading(false);
    }
  };

  // Toggle seat selection locally
  const handleSeatClick = (seat) => {
    if (seat.status === 'BOOKED' || (seat.status === 'HELD' && seat.heldBy !== userId)) {
      return; // Unavailable
    }

    if (selectedSeatIds.includes(seat.id)) {
      setSelectedSeatIds((prev) => prev.filter((id) => id !== seat.id));
    } else {
      setSelectedSeatIds((prev) => [...prev, seat.id]);
    }
  };

  // Reserve selected seats (Trigger atomic Redis lock backend)
  const handleHoldSeats = async () => {
    if (selectedSeatIds.length === 0) return;
    setError('');

    try {
      const res = await fetch(`/api/shows/${showId}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatIds: selectedSeatIds, userId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Seat lock failed');

      // Start 10-minute hold countdown
      setHoldTimer(HOLD_TTL_SECONDS);
    } catch (err) {
      setError(err.message);
      fetchSeats(); // Sync state on conflict
    }
  };

  // Join waitlist if seats in a category are sold out
  const handleJoinWaitlist = async (category) => {
    try {
      const res = await fetch(`/api/shows/${showId}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, userId }),
      });
      const data = await res.json();
      alert(data.message || 'Successfully joined waitlist!');
    } catch (err) {
      alert('Failed to join waitlist');
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Group seats by Row
  const rows = seats.reduce((acc, seat) => {
    acc[seat.row] = acc[seat.row] || [];
    acc[seat.row].push(seat);
    return acc;
  }, {});

  if (loading) return <div style={styles.center}>Loading seat map...</div>;

  return (
    <div style={styles.container}>
      {/* Timer & Alerts */}
      {holdTimer !== null && holdTimer > 0 && (
        <div style={styles.timerBanner}>
          Seats held! Complete checkout in: <strong>{formatTime(holdTimer)}</strong>
        </div>
      )}
      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* Screen Indicator */}
      <div style={styles.screen}>STAGE / SCREEN</div>

      {/* Visual Seat Map Grid */}
      <div style={styles.grid}>
        {Object.keys(rows).map((rowLabel) => (
          <div key={rowLabel} style={styles.row}>
            <span style={styles.rowLabel}>{rowLabel}</span>
            {rows[rowLabel].map((seat) => {
              const isSelected = selectedSeatIds.includes(seat.id);
              const isMine = seat.heldBy === userId;
              
              let backgroundColor = '#2ecc71'; // Available (Green)
              if (seat.category === 'Premium') backgroundColor = '#9b59b6'; // Premium (Purple)
              if (seat.status === 'HELD') backgroundColor = isMine ? '#f1c40f' : '#e67e22'; // Mine (Yellow) / Held (Orange)
              if (seat.status === 'BOOKED') backgroundColor = '#e74c3c'; // Booked (Red)

              return (
                <button
                  key={seat.id}
                  onClick={() => handleSeatClick(seat)}
                  disabled={seat.status === 'BOOKED' || (seat.status === 'HELD' && !isMine)}
                  style={{
                    ...styles.seat,
                    backgroundColor,
                    border: isSelected ? '3px solid #000' : '1px solid #ccc',
                    cursor: seat.status === 'BOOKED' ? 'not-allowed' : 'pointer',
                  }}
                  title={`${seat.row}${seat.number} - $${categoryPrices[seat.category]}`}
                >
                  {seat.number}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Map Legend */}
      <div style={styles.legend}>
        <span style={{ color: '#2ecc71' }}>■ Standard</span>
        <span style={{ color: '#9b59b6' }}>■ Premium</span>
        <span style={{ color: '#f1c40f' }}>■ Selected</span>
        <span style={{ color: '#e67e22' }}>■ Held</span>
        <span style={{ color: '#e74c3c' }}>■ Booked</span>
      </div>

      {/* Actions Bar */}
      <div style={styles.actions}>
        <div>
          Selected: {selectedSeatIds.length} seat(s) | Total: $
          {selectedSeatIds.reduce((sum, id) => {
            const seat = seats.find((s) => s.id === id);
            return sum + (categoryPrices[seat?.category] || 0);
          }, 0)}
        </div>
        <button
          onClick={handleHoldSeats}
          disabled={selectedSeatIds.length === 0}
          style={styles.holdBtn}
        >
          Hold & Proceed to Checkout
        </button>
      </div>

      {/* Sold Out / Waitlist Option */}
      {seats.every((s) => s.status === 'BOOKED') && (
        <div style={styles.waitlistCard}>
          <h3>Event Sold Out</h3>
          <p>Join the waitlist to auto-receive seats if someone cancels:</p>
          <button onClick={() => handleJoinWaitlist('Premium')} style={styles.waitlistBtn}>
            Join Waitlist (Premium)
          </button>
          <button onClick={() => handleJoinWaitlist('Standard')} style={styles.waitlistBtn}>
            Join Waitlist (Standard)
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif' },
  screen: { width: '100%', height: '30px', background: '#333', color: '#fff', textAlign: 'center', lineHeight: '30px', borderRadius: '4px', marginBottom: '30px' },
  grid: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  rowLabel: { width: '20px', fontWeight: 'bold' },
  seat: { width: '36px', height: '36px', borderRadius: '6px', color: '#fff', fontWeight: 'bold' },
  legend: { display: 'flex', justifyContent: 'center', gap: '15px', marginTop: '20px' },
  actions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', padding: '15px', borderTop: '1px solid #ddd' },
  holdBtn: { padding: '10px 20px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  timerBanner: { padding: '10px', background: '#fff3cd', color: '#856404', textAlign: 'center', marginBottom: '15px' },
  errorBanner: { padding: '10px', background: '#f8d7da', color: '#721c24', textAlign: 'center', marginBottom: '15px' },
  waitlistCard: { marginTop: '30px', padding: '20px', background: '#f8f9fa', textAlign: 'center', borderRadius: '8px' },
  waitlistBtn: { margin: '5px', padding: '8px 15px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px' },
  center: { textAlign: 'center', padding: '50px' }
};
