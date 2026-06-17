const fs = require('fs');

const profile = JSON.parse(fs.readFileSync('profile.cpuprofile', 'utf8'));

// We will compute the exclusive (self) time for each node
const timeMap = new Map();
let prevTime = profile.startTime;

for (let i = 0; i < profile.samples.length; i++) {
  const nodeId = profile.samples[i];
  const timeDiff = profile.timeDeltas[i];
  
  if (!timeMap.has(nodeId)) {
    timeMap.set(nodeId, 0);
  }
  timeMap.set(nodeId, timeMap.get(nodeId) + timeDiff);
}

// Map nodeId to node details
const nodeMap = new Map();
for (const node of profile.nodes) {
  nodeMap.set(node.id, node);
}

const results = [];
for (const [nodeId, time] of timeMap.entries()) {
  const node = nodeMap.get(nodeId);
  const callFrame = node.callFrame;
  const name = `${callFrame.functionName || '(anonymous)'} (${callFrame.url}:${callFrame.lineNumber})`;
  results.push({ name, time });
}

results.sort((a, b) => b.time - a.time);

console.log("Top CPU consuming functions (exclusive time in microseconds):");
for (let i = 0; i < Math.min(20, results.length); i++) {
  console.log(`${results[i].time}us - ${results[i].name}`);
}
