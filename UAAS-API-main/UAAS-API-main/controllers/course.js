const { getMappedCrawlerData } = require("../util/xjtuEhallAdapter")

// XJTU mode: only return crawler-mapped course data.
const getList = async (ctx, next) => {
  const crawlerMapped = getMappedCrawlerData()
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
