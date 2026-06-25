const { DataSource } = require('typeorm');

function normalizeLine(line) {
  return line.replace(/\s+/g, ' ').trim();
}

function headingLevel(line) {
  const match = line.match(/^(#{1,6})\s+(.*)$/);
  if (!match) return null;
  return { level: match[1].length, text: normalizeLine(match[2]) };
}

function mindmapMarkdownToTree(markdown, title = 'Mindmap') {
  const root = { label: title, children: [] };
  const stack = [{ level: 0, node: root }];

  const lines = String(markdown || '')
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  for (const line of lines) {
    const heading = headingLevel(line);
    if (!heading) {
      const current = stack[stack.length - 1]?.node;
      if (current) {
        current.children = current.children || [];
        current.children.push({ label: line });
      }
      continue;
    }

    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]?.node ?? root;
    parent.children = parent.children || [];
    const node = { label: heading.text, children: [] };
    parent.children.push(node);
    stack.push({ level: heading.level, node });
  }

  if (!root.children || !root.children.length) {
    root.children = markdown
      .split(/\r?\n/)
      .map(normalizeLine)
      .filter(Boolean)
      .map((line) => ({ label: line }));
  }

  if (
    root.children &&
    root.children.length === 1 &&
    root.children[0].children &&
    root.children[0].children.length > 0
  ) {
    root.children = root.children[0].children;
  }

  return root;
}


function printTree(node, maxLevels, currentLevel = 0, prefix = '') {
  if (currentLevel >= maxLevels) return;
  console.log(`${prefix}${currentLevel === 0 ? 'Root: ' : '├─ '}${node.label}`);
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const isLast = i === node.children.length - 1;
      const nextPrefix = currentLevel === 0 ? '' : prefix + (isLast ? '   ' : '│  ');
      printTree(child, maxLevels, currentLevel + 1, nextPrefix);
    }
  }
}

function countNodes(node) {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

function getDepth(node) {
  if (!node.children || node.children.length === 0) return 0;
  let max = 0;
  for (const child of node.children) {
    max = Math.max(max, getDepth(child));
  }
  return max + 1;
}

(async () => {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await ds.initialize();
  const res = await ds.query("SELECT description, title FROM study_materials WHERE type = 'mindmap' AND exam = 'school' ORDER BY created_at DESC LIMIT 1");
  
  if (res.length > 0) {
    const rawMarkdown = res[0].description;
    const title = res[0].title;
    
    // The codebase passes topic.name. The title in DB is 'Mindmap — Topic Name', let's just pass a mock topic name
    const topicName = title.split('—').pop().trim() || 'Topic Name';
    
    const tree = mindmapMarkdownToTree(rawMarkdown, topicName);
    
    console.log(`Root: ${tree.label}`);
    console.log(`\nRoot Children Count: ${tree.children ? tree.children.length : 0}`);
    console.log(`\nRoot Children:`);
    if (tree.children) {
      for (const child of tree.children) {
        console.log(`* ${child.label}`);
      }
    }
    
    console.log(`\nTree Preview:`);
    printTree(tree, 3);
    
    console.log(`\nTotal Node Count: ${countNodes(tree)}`);
    console.log(`Maximum Depth: ${getDepth(tree)}`);
    
  } else {
    console.log('No mindmap found');
  }
  await ds.destroy();
})().catch(console.error);
