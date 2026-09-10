import iris = require('kirakira-iris');
const moderator: iris.Iris = iris.createIris({ keywords: ['示例'] });
const result: iris.KeywordResult = moderator.keywordModerate('示例');
const hit: boolean = result.hit;
const word: string | undefined = result.matchesInSource[0]?.hitWord;
moderator.refreshKeywords(['新词']);
const cleared: number = moderator.clearAIQueue();
void [hit, cleared, word];
