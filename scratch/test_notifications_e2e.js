const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const STUDENT_USER_ID = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54';
const TEACHER_USER_ID = '526d9c0e-e2cd-4999-b1ec-a24646474796';

async function runTest() {
  console.log('--- STARTING NOTIFICATION SYSTEM E2E TEST ---');
  
  // 1. Establish socket connection to namespace /notifications
  console.log('Connecting to socket: http://localhost:3000/notifications');
  const socket = io('http://localhost:3000/notifications', {
    transports: ['websocket']
  });

  let notificationReceived = false;

  socket.on('connect', () => {
    console.log('[Socket] Connected, ID:', socket.id);
    
    // 2. Join student user room
    console.log(`[Socket] Joining room: user:${STUDENT_USER_ID}`);
    socket.emit('join_user', STUDENT_USER_ID);
  });

  socket.on('new_notification', (data) => {
    console.log('[Socket] New notification received!:', data);
    if (data.title === 'E2E Integration Test Notification') {
      notificationReceived = true;
      console.log('\n=====================================================================');
      console.log('🎉 SUCCESS: WebSocket Real-Time E2E Notification Pushed & Received!');
      console.log('=====================================================================\n');
      socket.disconnect();
      process.exit(0);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err.message);
  });

  // Wait 2 seconds, then trigger notification creation via HTTP API
  setTimeout(async () => {
    try {
      console.log('Generating JWT token for admin auth...');
      const token = jwt.sign(
        { id: 'demo-super-admin', role: 'SUPER_ADMIN', email: 'admin@gmail.com', name: 'Super Admin' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      console.log('Sending HTTP POST request to trigger notification...');
      const response = await axios.post(
        'http://localhost:3000/api/v1/school/notifications',
        {
          recipientId: STUDENT_USER_ID,
          senderId: TEACHER_USER_ID,
          role: 'STUDENT',
          type: 'info',
          title: 'E2E Integration Test Notification',
          message: 'This is a real-time message pushed by the automated integration test!',
          actionUrl: '/school/student/dashboard'
        },
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      console.log('[HTTP] Response code:', response.status);
      console.log('[HTTP] Response body:', response.data);
    } catch (err) {
      console.error('[HTTP] Failed to trigger notification:', err.message);
      if (err.response) {
        console.error('[HTTP] Response error data:', err.response.data);
      }
      socket.disconnect();
      process.exit(1);
    }
  }, 2000);

  // Set timeout safety net
  setTimeout(() => {
    if (!notificationReceived) {
      console.error('❌ FAILED: Timeout waiting for WebSocket notification');
      socket.disconnect();
      process.exit(1);
    }
  }, 10000);
}

runTest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
