const { readMappedCrawlerData } = require("../services/crawlerDataService")

// XJTU mode: only return crawler-mapped course data.
const getList = async (ctx, next) => {
  const token = String((ctx.request && ctx.request.headers && ctx.request.headers.token) || "")
  const m = token.match(/xjtu-(\d+)-/i)
  const stuId = m ? m[1] : ""
  const crawlerMapped = await readMappedCrawlerData(stuId)
  if (crawlerMapped && Array.isArray(crawlerMapped.courseList) && crawlerMapped.courseList.length) {
    ctx.result = crawlerMapped.courseList
    return next()
  }

  ctx.result = []
  return next()
}

module.exports = {
  getList,
}
