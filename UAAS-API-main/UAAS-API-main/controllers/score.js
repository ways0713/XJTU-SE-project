const { getMappedCrawlerData } = require("../util/xjtuEhallAdapter")

// XJTU mode: only return crawler-mapped score data.
const getList = async (ctx, next) => {
  const crawlerMapped = getMappedCrawlerData()
  if (crawlerMapped && Array.isArray(crawlerMapped.scoreList) && crawlerMapped.scoreList.length) {
    ctx.result = crawlerMapped.scoreList
    return next()
  }

  ctx.result = []
  return next()
}

const getRawList = async (ctx, next) => {
  const crawlerMapped = getMappedCrawlerData()
  if (crawlerMapped && Array.isArray(crawlerMapped.rawScoreList) && crawlerMapped.rawScoreList.length) {
    ctx.result = crawlerMapped.rawScoreList
    return next()
  }

  ctx.result = []
  return next()
}

module.exports = {
  getList,
  getRawList,
}
