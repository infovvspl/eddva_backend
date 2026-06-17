const WebSocket = require('ws');
const fs = require('fs');

(async () => {
  const res = await fetch('http://127.0.0.1:9229/json');
  const targets = await res.json();
  const wsUrl = targets[0].webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
  let id = 1;

  const send = (method, params = {}) => new Promise((resolve) => {
    const msgId = id++;
    const listener = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === msgId) {
        ws.removeListener('message', listener);
        resolve(msg.result);
      }
    };
    ws.on('message', listener);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  ws.on('open', async () => {
    await send('Profiler.enable');
    await send('Profiler.start');
    console.log('Profiling started');
    
    setTimeout(async () => {
      const profile = await send('Profiler.stop');
      fs.writeFileSync('profile.cpuprofile', JSON.stringify(profile.profile));
      console.log('Profiling stopped and saved to profile.cpuprofile');
      process.exit(0);
    }, 5000);
  });
})();
