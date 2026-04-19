const Router = require("@koa/router")
const router = new Router()

const scoreController = require("../controllers/score")
const attendanceController = require("../controllers/attendance")
const courseController = require("../controllers/course")
const ddlController = require("../controllers/ddl")
const crawlerController = require("../controllers/crawler")

const authHandler = async (ctx, next) => {
  const { token } = ctx.request.headers
  if (!token) {
    ctx.throw(401, "请求头中的token不能为空")
  }
  return next()
}

router.use(authHandler)

// 成绩
router.get("/scores", scoreController.getList)
router.get("/raw-scores", scoreController.getRawList)
// 考勤（旧路由兼容 + 新路由对齐前端）
router.get("/attendances", attendanceController.getList)
router.get("/attendance", attendanceController.getSimpleList)
// 课表
router.get("/courses", courseController.getList)
// DDL
router.get("/ddl", ddlController.getList)
router.patch("/ddl/:id", ddlController.updateItem)
// 爬虫任务
router.post("/crawl/xjtu/trigger", crawlerController.triggerXjtuCrawler)
router.get("/crawl/xjtu/status", crawlerController.getXjtuCrawlerStatus)

module.exports = router
