"use strict"

const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const { getMappedSyxtDdlData, resolveSyxtDdlOutputPath, sanitizeStuId } = require("../util/syxtDdlAdapter")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const CRAWLER_SCRIPT = path.resolve(PROJECT_ROOT, "scripts", "xjtu-syxt-ddl-crawler.js")
const CRAWL_TIMEOUT_MS = Number(process.env.XJTU_SYXT_CRAWL_TIMEOUT_MS || 240000)
const LOG_TAIL_LIMIT = 16000

const crawlState = {
  running: false,
  startedAt: 0,
  finishedAt: 0,
  lastSuccessAt: 0,
  lastError: "",
  lastLogs: "",
  lastSummary: null,
  activeStuId: "",
}

function toIso(ts) {
  return ts ? new Date(ts).toISOString() : ""
}

function appendTailText(buffer, text, maxLen = LOG_TAIL_LIMIT) {
  const merged = `${buffer || ""}${text || ""}`
  if (merged.length <= maxLen) return merged
  return merged.slice(-maxLen)
}

function setFailed(reason, logs = "") {
  crawlState.lastError = String(reason || "SYXT DDL爬取失败")
  crawlState.lastLogs = String(logs || "")
}

function buildSummary(stuId = "") {
  const mapped = getMappedSyxtDdlData(stuId)
  if (!mapped) {
    return {
      count: 0,
      fetchedAt: "",
      sourceFile: resolveSyxtDdlOutputPath(stuId),
    }
  }
  return {
    count: Array.isArray(mapped.list) ? mapped.list.length : 0,
    fetchedAt: mapped.fetchedAt || "",
    sourceFile: mapped.sourceFile || resolveSyxtDdlOutputPath(stuId),
    error: mapped.error || "",
  }
}

function runCrawlerInBackground({ stuId, password }) {
  const safeStuId = sanitizeStuId(stuId)
  const safePassword = String(password || "").trim()
  const outputPath = resolveSyxtDdlOutputPath(safeStuId)

  crawlState.running = true
  crawlState.startedAt = Date.now()
  crawlState.finishedAt = 0
  crawlState.lastError = ""
  crawlState.lastLogs = ""
  crawlState.lastSummary = null
  crawlState.activeStuId = safeStuId

  const child = spawn(process.execPath, [CRAWLER_SCRIPT], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      XJTU_SYXT_USER: safeStuId,
      XJTU_SYXT_PASS: safePassword,
      XJTU_SYXT_OUTPUT: outputPath,
      XJTU_SYXT_HEADLESS: process.env.XJTU_SYXT_HEADLESS || process.env.XJTU_HEADLESS || "true",
      XJTU_SYXT_DEBUG: process.env.XJTU_SYXT_DEBUG || process.env.XJTU_DEBUG || "false",
      XJTU_SYXT_WAIT_MS: process.env.XJTU_SYXT_WAIT_MS || process.env.XJTU_WAIT_MS || "60000",
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
    const text = String(chunk || "")
    logs = appendTailText(logs, text)
    if ((process.env.XJTU_SYXT_DEBUG || "").toLowerCase() === "true") {
      process.stdout.write(text)
    }
  })

  child.stderr.on("data", (chunk) => {
    const text = String(chunk || "")
    logs = appendTailText(logs, text)
    if ((process.env.XJTU_SYXT_DEBUG || "").toLowerCase() === "true") {
      process.stderr.write(text)
    }
  })

  child.on("error", (err) => {
    finish(() => {
      setFailed(`SYXT DDL crawler start failed: ${err && err.message ? err.message : "unknown"}`, logs)
    })
  })

  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 5000)
  }, CRAWL_TIMEOUT_MS)

  child.on("close", (code) => {
    finish(() => {
      if (timedOut) {
        setFailed(`SYXT DDL crawler timeout (${CRAWL_TIMEOUT_MS}ms)`, logs)
        return
      }
      if (code !== 0) {
        const tail = String(logs || "")
          .trim()
          .split(/\r?\n/)
          .slice(-4)
          .join(" | ")
        setFailed(`SYXT DDL crawler exited with code=${code}${tail ? `: ${tail}` : ""}`, logs)
        return
      }

      crawlState.lastSuccessAt = Date.now()
      crawlState.lastError = ""
      crawlState.lastLogs = logs
      crawlState.lastSummary = {
        ...buildSummary(safeStuId),
        finishedAt: toIso(crawlState.lastSuccessAt),
        stuId: safeStuId,
      }
    })
  })
}

const triggerSyxtDdlCrawler = async (ctx, next) => {
  const { stuId, password } = ctx.request.body || {}
  const safeStuId = sanitizeStuId(stuId)
  const safePassword = String(password || "").trim()

  if (!safeStuId || !safePassword) {
    ctx.errMsg = "学号和密码不能为空"
    return next()
  }
  if (!fs.existsSync(CRAWLER_SCRIPT)) {
    ctx.errMsg = "SYXT DDL爬虫脚本不存在"
    return next()
  }
  if (crawlState.running) {
    ctx.result = {
      started: false,
      running: true,
      message: "SYXT DDL 爬取任务正在执行中",
      startedAt: toIso(crawlState.startedAt),
      activeStuId: crawlState.activeStuId || "",
    }
    return next()
  }

  runCrawlerInBackground({ stuId: safeStuId, password: safePassword })
  ctx.result = {
    started: true,
    running: true,
    message: "已触发 SYXT DDL 后台爬取任务",
    startedAt: toIso(crawlState.startedAt),
    activeStuId: safeStuId,
  }
  return next()
}

const getSyxtDdlCrawlerStatus = async (ctx, next) => {
  const activeStuId = crawlState.activeStuId || ""
  const summary = crawlState.lastSummary || buildSummary(activeStuId)
  ctx.result = {
    running: crawlState.running,
    startedAt: toIso(crawlState.startedAt),
    finishedAt: toIso(crawlState.finishedAt),
    lastSuccessAt: toIso(crawlState.lastSuccessAt),
    lastError: crawlState.lastError || "",
    lastLogs: crawlState.lastLogs || "",
    activeStuId,
    summary,
  }
  return next()
}

module.exports = {
  triggerSyxtDdlCrawler,
  getSyxtDdlCrawlerStatus,
}

