const { readMappedCrawlerData } = require("../services/crawlerDataService")

// XJTU mode: only return crawler-mapped score data.
const getList = async (ctx, next) => {
  const token = String((ctx.request && ctx.request.headers && ctx.request.headers.token) || "")
  const m = token.match(/xjtu-(\d+)-/i)
  const stuId = m ? m[1] : ""
  const crawlerMapped = await readMappedCrawlerData(stuId)
  if (crawlerMapped && Array.isArray(crawlerMapped.scoreList) && crawlerMapped.scoreList.length) {
    ctx.result = crawlerMapped.scoreList
    return next()
  }

  ctx.result = []
  return next()
}

const getRawList = async (ctx, next) => {
  const token = String((ctx.request && ctx.request.headers && ctx.request.headers.token) || "")
  const m = token.match(/xjtu-(\d+)-/i)
  const stuId = m ? m[1] : ""
  const crawlerMapped = await readMappedCrawlerData(stuId)
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
