const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const {
  readMappedCrawlerData,
  syncLatestCrawlerOutputToMongo,
} = require("../services/crawlerDataService")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const CRAWLER_SCRIPT = path.resolve(PROJECT_ROOT, "scripts", "xjtu-ehall-crawler.js")
const CRAWL_TIMEOUT_MS = Number(process.env.XJTU_CRAWL_TIMEOUT_MS || 240000)
const LOG_TAIL_LIMIT = 8000
const TARGET_ALL = "all"
const TARGET_COURSE = "course"
const TARGET_SCORE = "score"
const SUPPORTED_TARGETS = new Set([TARGET_ALL, TARGET_COURSE, TARGET_SCORE])

const crawlState = {
  running: false,
  activeStuId: "",
  startedAt: 0,
  finishedAt: 0,
  lastSuccessAt: 0,
  lastError: "",
  lastSummary: null,
  lastLogs: "",
  activeTarget: TARGET_ALL,
}

function toIso(ts) {
  return ts ? new Date(ts).toISOString() : ""
}

function normalizeTarget(target) {
  const safe = String(target || "").trim().toLowerCase()
  return SUPPORTED_TARGETS.has(safe) ? safe : TARGET_ALL
}

async function buildSummary(stuId = "") {
  const mapped = await readMappedCrawlerData(stuId)
  if (!mapped) {
    return {
      stuId: String(stuId || "").trim(),
      target: crawlState.activeTarget,
      courseCount: 0,
      scoreTermCount: 0,
      rawScoreTermCount: 0,
    }
  }

  return {
    stuId: String(stuId || "").trim(),
    target: crawlState.activeTarget,
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

function runCrawlerInBackground({ stuId, password, target = TARGET_ALL }) {
  const safeStuId = String(stuId || "").trim()
  const safeTarget = normalizeTarget(target)

  crawlState.running = true
  crawlState.activeStuId = safeStuId
  crawlState.startedAt = Date.now()
  crawlState.finishedAt = 0
  crawlState.lastError = ""
  crawlState.lastLogs = ""
  crawlState.activeTarget = safeTarget

  const child = spawn(process.execPath, [CRAWLER_SCRIPT], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      XJTU_EHALL_USER: safeStuId,
      XJTU_EHALL_PASS: String(password || "").trim(),
      XJTU_CRAWL_TARGET: safeTarget,
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
    crawlState.activeStuId = ""
    crawlState.finishedAt = Date.now()
    handler()
  }

  child.stdout.on("data", (chunk) => {
    const text = String(chunk || "")
    logs = appendTailText(logs, text)
    if ((process.env.XJTU_DEBUG || "").toLowerCase() === "true") {
      process.stdout.write(text)
    }
  })

  child.stderr.on("data", (chunk) => {
    const text = String(chunk || "")
    logs = appendTailText(logs, text)
    if ((process.env.XJTU_DEBUG || "").toLowerCase() === "true") {
      process.stderr.write(text)
    }
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
    finish(async () => {
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
      await syncLatestCrawlerOutputToMongo(safeStuId).catch(() => false)

      crawlState.lastSummary = {
        ...(await buildSummary(safeStuId).catch(() => ({
          stuId: safeStuId,
          target: safeTarget,
          courseCount: 0,
          scoreTermCount: 0,
          rawScoreTermCount: 0,
        }))),
        target: safeTarget,
        finishedAt: toIso(crawlState.lastSuccessAt),
      }
    })
  })
}

function validateTriggerInput(ctx) {
  const { stuId, password } = ctx.request.body || {}
  const safeStuId = String(stuId || "").trim()
  const safePassword = String(password || "").trim()

  if (!safeStuId || !safePassword) {
    ctx.errMsg = "学号和密码不能为空"
    return null
  }

  if (!fs.existsSync(CRAWLER_SCRIPT)) {
    ctx.errMsg = "爬虫脚本不存在，无法启动任务"
    return null
  }

  return { stuId: safeStuId, password: safePassword }
}

async function triggerByTarget(ctx, next, target) {
  const creds = validateTriggerInput(ctx)
  if (!creds) return next()

  const safeTarget = normalizeTarget(target)
  if (crawlState.running) {
    ctx.result = {
      started: false,
      running: true,
      target: crawlState.activeTarget || TARGET_ALL,
      message: "爬虫任务正在执行中",
      startedAt: toIso(crawlState.startedAt),
    }
    return next()
  }

  crawlState.lastSummary = null
  runCrawlerInBackground({
    stuId: creds.stuId,
    password: creds.password,
    target: safeTarget,
  })
  ctx.result = {
    started: true,
    running: true,
    target: safeTarget,
    message: "已触发后台爬取任务",
    startedAt: toIso(crawlState.startedAt),
  }
  return next()
}

// POST /crawl/xjtu/trigger (legacy: crawl all)
const triggerXjtuCrawler = async (ctx, next) => triggerByTarget(ctx, next, TARGET_ALL)

// POST /crawl/xjtu/course/trigger
const triggerXjtuCourseCrawler = async (ctx, next) => triggerByTarget(ctx, next, TARGET_COURSE)

// POST /crawl/xjtu/score/trigger
const triggerXjtuScoreCrawler = async (ctx, next) => triggerByTarget(ctx, next, TARGET_SCORE)

// GET /crawl/xjtu/status
const getXjtuCrawlerStatus = async (ctx, next) => {
  const token = String((ctx.request && ctx.request.headers && ctx.request.headers.token) || "")
  const m = token.match(/xjtu-(\d+)-/i)
  const authStuId = m ? m[1] : ""
  ctx.result = {
    running: crawlState.running && (!authStuId || authStuId === crawlState.activeStuId),
    target: crawlState.activeTarget || TARGET_ALL,
    startedAt: toIso(crawlState.startedAt),
    finishedAt: toIso(crawlState.finishedAt),
    lastSuccessAt: toIso(crawlState.lastSuccessAt),
    lastError: crawlState.lastError || "",
    lastLogs: crawlState.lastLogs || "",
    summary:
      (crawlState.lastSummary && crawlState.lastSummary.stuId === authStuId ? crawlState.lastSummary : null) ||
      (await buildSummary(authStuId).catch(() => null)) || {
        stuId: authStuId,
        target: crawlState.activeTarget || TARGET_ALL,
        courseCount: 0,
        scoreTermCount: 0,
        rawScoreTermCount: 0,
      },
  }
  return next()
}

module.exports = {
  triggerXjtuCrawler,
  triggerXjtuCourseCrawler,
  triggerXjtuScoreCrawler,
  getXjtuCrawlerStatus,
}

