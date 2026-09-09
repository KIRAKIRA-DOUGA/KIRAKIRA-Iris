import { createIris } from '../dist/esm/index.js';

// Demonstration rules only; replace with your own reviewed moderation dictionary.
const iris = createIris({
  keywords: [
    { word: '示例提示', severity: 'general', comment: '这是一般提示。' },
    { word: '示例危险词', severity: 'dangerous', comment: '需要结合上下文复核。' },
    { word: '示例极危词', severity: 'extreme', comment: '这是极度危险的示例规则。' },
  ],
  aiFilter: false,
});

console.log(JSON.stringify(await iris.moderate('这里是示例危\n-险词。'), null, 2));
