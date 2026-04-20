const Router = require("@koa/router")
const router = new Router()

const scoreController = require("../controllers/score")
const attendanceController = require("../controllers/attendance")
const courseController = require("../controllers/course")
const ddlController = require("../controllers/ddl")
const crawlerController = require("../controllers/crawler")
const syxtDdlCrawlerController = require("../controllers/syxtDdlCrawler")
const bkkqAttendanceCrawlerController = require("../controllers/bkkqAttendanceCrawler")
const resourcesController = require("../controllers/resources")

const authHandler = async (ctx, next) => {
  if (ctx.path === "/resources" || ctx.path === "/resources/upload") {
    return next()
  }
  const { token } = ctx.request.headers
  if (!token) {
    ctx.throw(401, "请求头中的token不能为空")
  }
  return next()
}

router.use(authHandler)

// 公共资源接口（无需登录）
router.get("/resources", resourcesController.getList)
router.post("/resources/upload", resourcesController.uploadFile)
router.delete("/resources/:id", resourcesController.deleteFile)

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
router.post("/crawl/xjtu/course/trigger", crawlerController.triggerXjtuCourseCrawler)
router.post("/crawl/xjtu/score/trigger", crawlerController.triggerXjtuScoreCrawler)
router.get("/crawl/xjtu/status", crawlerController.getXjtuCrawlerStatus)
router.post("/crawl/syxt/ddl/trigger", syxtDdlCrawlerController.triggerSyxtDdlCrawler)
router.get("/crawl/syxt/ddl/status", syxtDdlCrawlerController.getSyxtDdlCrawlerStatus)
router.post("/crawl/xjtu/attendance/trigger", bkkqAttendanceCrawlerController.triggerBkkqAttendanceCrawler)
router.get("/crawl/xjtu/attendance/status", bkkqAttendanceCrawlerController.getBkkqAttendanceCrawlerStatus)

module.exports = router
