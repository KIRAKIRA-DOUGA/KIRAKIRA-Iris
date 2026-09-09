import iris = require('kirakira-iris');
const moderator: iris.Iris = iris.createIris({ aiFilter: false });
const result: iris.KeywordResult = moderator.checkKeywords('example');
const hit: boolean = result.hite;
void hit;
