import iris = require('kirakira-iris');
const moderator: iris.Iris = iris.createIris({ keywords: ['示例'] });
const result: iris.KeywordResult = moderator.keywordModerate('示例');
const hit: boolean = result.hite;
moderator.refreshKeywords(['新词']);
void hit;
