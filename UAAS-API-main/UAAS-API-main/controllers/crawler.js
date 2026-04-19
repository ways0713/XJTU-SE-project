const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const { getMappedCrawlerData } = require("../util/xjtuEhallAdapter")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const CRAWLER_SCRIPT = path.resolve(PROJECT_ROOT, "scripts", "xjtu-ehall-crawler.js")
const CRAWL_TIMEOUT_MS = Number(process.env.XJTU_CRAWL_TIMEOUT_MS || 240000)
const LOG_TAIL_LIMIT = 8000

const crawlState = {
  running: false,
  startedAt: 0,
  finishedAt: 0,
  lastSuccessAt: 0,
  lastError: "",
  lastSummary: null,
  lastLogs: "",
}

function toIso(ts) {
  return ts ? new Date(ts).toISOString() : ""
}

function buildSummary() {
  const mapped = getMappedCrawlerData()
  if (!mapped) {
    return {
      courseCount: 0,
      scoreTermCount: 0,
      rawScoreTermCount: 0,
    }
  }

  return {
    courseCount: Array.isArray(mapped.courseList) ? mapped.courseList.length : 0,
    scoreTermCount: Array.isArray(mapped.scoreList) ? mapped.scoreList.length : 0,
    rawScoreTermCount: Array.isArray(mapped.rawScoreList) ? mapped.rawScoreList.length : 0,
    sourceFile: mapped.sourceFile || "",
  }
}

function appendTailText(buffer, text, maxLen = LOG_TAIL_LIMIT) {
  const merged = `${buffer || ""}${text || ""}`
  if (merged.length <= maxLen) return merged
  return merged.slice(-maxLen)
}

function setFailed(reason, logs = "") {
  crawlState.lastError = String(reason || "爬取失败")
  crawlState.lastLogs = String(logs || "")
}

function runCrawlerInBackground({ stuId, password }) {
  crawlState.running = true
  crawlState.startedAt = Date.now()
  crawlState.finishedAt = 0
  crawlState.lastError = ""
  crawlState.lastLogs = ""

  const child = spawn(process.execPath, [CRAWLER_SCRIPT], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      XJTU_EHALL_USER: String(stuId || "").trim(),
      XJTU_EHALL_PASS: String(password || "").trim(),
      XJTU_MANUAL_LOGIN: "false",
      XJTU_MONITOR_ONLY: "false",
      XJTU_TRACE_OPS: "false",
      XJTU_HEADLESS: process.env.XJTU_HEADLESS || "true",
      XJTU_DEBUG: process.env.XJTU_DEBUG || "false",
      XJTU_WAIT_MS: process.env.XJTU_WAIT_MS || "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  let logs = ""
  let timedOut = false
  let finished = false

  const finish = (handler) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    crawlState.running = false
    crawlState.finishedAt = Date.now()
    handler()
  }

  child.stdout.on("data", (chunk) => {
    logs = appendTailText(logs, String(chunk || ""))
  })

  child.stderr.on("data", (chunk) => {
    logs = appendTailText(logs, String(chunk || ""))
  })

  child.on("error", (err) => {
    finish(() => {
      const reason = `爬虫进程启动失败: ${err && err.message ? err.message : "unknown error"}`
      setFailed(reason, logs)
    })
  })

  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
    setTimeout(() => {
      child.kill("SIGKILL")
    }, 5000)
  }, CRAWL_TIMEOUT_MS)

  child.on("close", (code) => {
    finish(() => {
      if (timedOut) {
        setFailed(`爬虫超时（${CRAWL_TIMEOUT_MS}ms）`, logs)
        return
      }

      if (code !== 0) {
        const trimmed = String(logs || "").trim()
        const tail = trimmed ? trimmed.split(/\r?\n/).slice(-4).join(" | ") : ""
        setFailed(`爬虫异常退出（code=${code}）${tail ? `: ${tail}` : ""}`, logs)
        return
      }

      crawlState.lastSuccessAt = Date.now()
      crawlState.lastError = ""
      crawlState.lastLogs = String(logs || "")
      crawlState.lastSummary = {
        ...buildSummary(),
        finishedAt: toIso(crawlState.lastSuccessAt),
      }
    })
  })
}

// POST /crawl/xjtu/trigger
const triggerXjtuCrawler = async (ctx, next) => {
  const { stuId, password } = ctx.request.body || {}
  const safeStuId = String(stuId || "").trim()
  const safePassword = String(password || "").trim()

  if (!safeStuId || !safePassword) {
    ctx.errMsg = "学号和密码不能为空"
    return next()
  }

  if (!fs.existsSync(CRAWLER_SCRIPT)) {
    ctx.errMsg = "爬虫脚本不存在，无法启动任务"
    return next()
  }

  if (crawlState.running) {
    ctx.result = {
      started: false,
      running: true,
      message: "爬虫任务正在执行中",
      startedAt: toIso(crawlState.startedAt),
    }
    return next()
  }

  crawlState.lastSummary = null
  runCrawlerInBackground({ stuId: safeStuId, password: safePassword })
  ctx.result = {
    started: true,
    running: true,
    message: "已触发后台爬取任务",
    startedAt: toIso(crawlState.startedAt),
  }
  return next()
}

// GET /crawl/xjtu/status
const getXjtuCrawlerStatus = async (ctx, next) => {
  ctx.result = {
    running: crawlState.running,
    startedAt: toIso(crawlState.startedAt),
    finishedAt: toIso(crawlState.finishedAt),
    lastSuccessAt: toIso(crawlState.lastSuccessAt),
    lastError: crawlState.lastError || "",
    lastLogs: crawlState.lastLogs || "",
    summary: crawlState.lastSummary || buildSummary(),
  }
  return next()
}

module.exports = {
  triggerXjtuCrawler,
  getXjtuCrawlerStatus,
}
