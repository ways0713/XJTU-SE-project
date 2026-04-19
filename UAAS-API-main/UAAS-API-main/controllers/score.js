const { getRequestToken } = require("../util/util")
const path = require("path")
const SCHOOL_CODE = require("../util/config")("SCHOOL_CODE")
const servicePath = `${path.resolve(__dirname, "../services")}/${SCHOOL_CODE}`
const services = require(servicePath)
const { getMappedCrawlerData } = require("../util/xjtuEhallAdapter")

// 获取全部有效成绩
const getList = async (ctx, next) => {
  const crawlerMapped = getMappedCrawlerData()
  if (crawlerMapped && Array.isArray(crawlerMapped.scoreList) && crawlerMapped.scoreList.length) {
    ctx.result = crawlerMapped.scoreList
    return next()
  }

  const cookie = getRequestToken(ctx)
  try {
    const scores = await services.getScoreList(cookie)
    ctx.result = scores
  } catch (err) {
    ctx.errMsg = err.message
  }
  return next()
}

// 获取全部原始成绩
const getRawList = async (ctx, next) => {
  const crawlerMapped = getMappedCrawlerData()
  if (crawlerMapped && Array.isArray(crawlerMapped.rawScoreList) && crawlerMapped.rawScoreList.length) {
    ctx.result = crawlerMapped.rawScoreList
    return next()
  }

  const cookie = getRequestToken(ctx)
  if (!services.getRawScoreList) {
    ctx.errMsg = "该学校暂不支持查询原始成绩"
    return next()
  }
  try {
    const scores = await services.getRawScoreList(cookie)
    ctx.result = scores
  } catch (err) {
    ctx.errMsg = err.message
  }
  return next()
}

module.exports = {
  getList,
  getRawList,
}

