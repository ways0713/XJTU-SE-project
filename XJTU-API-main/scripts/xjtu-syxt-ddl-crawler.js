#!/usr/bin/env node
/*
 * XJTU LMS DDL crawler (independent module)
 * Flow:
 *   1) open https://lms.xjtu.edu.cn/user/index#/
 *   2) auto redirect to CAS
 *   3) fill student id/password and login
 *   4) return to LMS and capture "todo" style data
 */

"use strict"

const fs = require("fs")
const path = require("path")
require("dotenv").config()

let chromium
try {
  ;({ chromium } = require("playwright"))
} catch (err) {
  console.error("[syxt-ddl-crawler] Playwright not found. Run: npm i playwright")
  process.exit(1)
}

const ENTRY_URL = process.env.XJTU_LMS_ENTRY || process.env.XJTU_SYXT_ENTRY || "https://lms.xjtu.edu.cn/user/index#/"
const OUTPUT_PATH = process.env.XJTU_SYXT_OUTPUT || "./output/xjtu-syxt-ddl.json"
const USERNAME = process.env.XJTU_SYXT_USER || process.env.XJTU_EHALL_USER || process.env.XJTU_USER || ""
const PASSWORD = process.env.XJTU_SYXT_PASS || process.env.XJTU_EHALL_PASS || process.env.XJTU_PASS || ""
const WAIT_MS = Number(process.env.XJTU_SYXT_WAIT_MS || process.env.XJTU_WAIT_MS || 60000)
const HEADLESS = (process.env.XJTU_SYXT_HEADLESS || process.env.XJTU_HEADLESS || "true").toLowerCase() !== "false"
const DEBUG = (process.env.XJTU_SYXT_DEBUG || process.env.XJTU_DEBUG || "false").toLowerCase() === "true"
const BROWSER_PATH = process.env.XJTU_SYXT_BROWSER_PATH || process.env.XJTU_BROWSER_PATH || ""

function ensureDir(filePath) {
  const dir = path.dirname(path.resolve(filePath))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function nowIso() {
  return new Date().toISOString()
}

function toText(v) {
  if (v === null || v === undefined) return ""
  return String(v).replace(/\s+/g, " ").trim()
}

function looksLikeCasUrl(rawUrl) {
  const u = toText(rawUrl).toLowerCase()
  return u.includes("login.xjtu.edu.cn") || u.includes("/cas/")
}

function looksLikeLmsDomain(rawUrl) {
  const u = toText(rawUrl).toLowerCase()
  return u.includes("lms.xjtu.edu.cn")
}

function clip(s, n = 500) {
  const t = toText(s)
  if (t.length <= n) return t
  return `${t.slice(0, n)}...`
}

async function launchBrowser() {
  const options = { headless: HEADLESS }
  if (BROWSER_PATH) {
    options.executablePath = BROWSER_PATH
  } else if (process.platform === "win32") {
    options.channel = "chrome"
  }
  const browser = await chromium.launch(options)
  if (DEBUG) {
    console.log(`[syxt-ddl-crawler] Browser launched. headless=${HEADLESS}`)
  }
  return browser
}

async function clickFirstVisible(page, selectors, timeoutMs = 1500) {
  for (const selector of selectors || []) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)
    for (let i = 0; i < count; i++) {
      const el = locator.nth(i)
      const visible = await el.isVisible().catch(() => false)
      const enabled = await el.isEnabled().catch(() => false)
      if (!visible || !enabled) continue
      try {
        await el.click({ timeout: timeoutMs })
        return true
      } catch (_) {}
    }
  }
  return false
}

async function fillFirstVisible(page, selectors, value, timeoutMs = 1500) {
  for (const selector of selectors || []) {
    const locator = page.locator(selector)
    const count = await locator.count().catch(() => 0)
    for (let i = 0; i < count; i++) {
      const el = locator.nth(i)
      const visible = await el.isVisible().catch(() => false)
      const enabled = await el.isEnabled().catch(() => false)
      if (!visible || !enabled) continue
      try {
        await el.fill(value, { timeout: timeoutMs })
        return true
      } catch (_) {}
    }
  }
  return false
}

async function waitForUrlMatch(context, predicate, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pages = context.pages().slice().reverse()
    for (const p of pages) {
      const url = p.url()
      if (predicate(url)) return p
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}

function getCasLoginSelectors() {
  return {
    user: [
      "input[name='username']",
      "input[name='userName']",
      "input#username",
      "input[type='text']",
      "input[placeholder*='学号']",
      "input[placeholder*='账号']",
      "input[placeholder*='职工号']",
      "input[placeholder*='手机号']",
    ],
    pass: [
      "input[type='password']",
      "input[name='password']:not([type='hidden'])",
      "input#password:not([type='hidden'])",
      "input[placeholder*='密码']",
    ],
    submit: [
      "button.login-btn",
      "button[type='submit']",
      "button:has-text('登录')",
      "button:has-text('Login')",
      "input[type='submit']",
      "#login_submit",
    ],
  }
}

async function openCasFromLmsEntry(page, context) {
  await page.goto(ENTRY_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS })
  await page.waitForTimeout(800).catch(() => {})

  const casDirect = await waitForUrlMatch(context, looksLikeCasUrl, 8000)
  if (casDirect) {
    return { needsLogin: true, casPage: casDirect, lmsPage: null }
  }

  const lmsDirect = await waitForUrlMatch(context, looksLikeLmsDomain, 3000)
  if (lmsDirect && !looksLikeCasUrl(lmsDirect.url())) {
    return { needsLogin: false, casPage: null, lmsPage: lmsDirect }
  }

  // Fallback for unexpected LMS skins that still require manual click.
  const loginSelectors = [
    "a[href*='login.xjtu.edu.cn']",
    "a[href*='/cas/']",
    "button:has-text('Login')",
    "a:has-text('Login')",
    "text=Login",
    "button:has-text('登录')",
    "a:has-text('登录')",
  ]
  const clicked = await clickFirstVisible(page, loginSelectors, 2200).catch(() => false)
  const casPage = await waitForUrlMatch(context, looksLikeCasUrl, clicked ? WAIT_MS : 4000)
  if (!casPage) {
    if (!clicked) throw new Error("LMS did not auto-redirect to CAS, and no login entry button found.")
    throw new Error("Could not reach CAS login page from LMS entry.")
  }
  return { needsLogin: true, casPage, lmsPage: null }
}

async function autoLoginCas(page, context) {
  if (!USERNAME || !PASSWORD) {
    throw new Error("Missing credentials. Set XJTU_SYXT_USER/XJTU_SYXT_PASS.")
  }

  const selectors = getCasLoginSelectors()
  const filledUser = await fillFirstVisible(page, selectors.user, USERNAME)
  const filledPass = await fillFirstVisible(page, selectors.pass, PASSWORD)
  if (!filledUser || !filledPass) {
    throw new Error(`Could not fill CAS credentials. currentUrl=${page.url()}`)
  }

  const clicked = await clickFirstVisible(page, selectors.submit, 3000)
  if (!clicked) {
    throw new Error("Could not find CAS login submit button.")
  }

  const lmsPage = await waitForUrlMatch(context, looksLikeLmsDomain, WAIT_MS)
  if (!lmsPage) {
    throw new Error("CAS submitted but did not redirect back to LMS in time.")
  }
  return lmsPage
}

async function collectTodoItemsViaDom(page) {
  const rows = await page
    .evaluate(() => {
      const textOf = (el) => String((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim()
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim()

      const parseOne = (root) => {
        if (!root) return null
        const t = textOf(root)
        if (!t) return null
        const lines = t
          .split(/\n+/)
          .map((x) => norm(x))
          .filter(Boolean)
        if (!lines.length) return null

        const deadlineLine =
          lines.find((x) => /截止|due|ddl|deadline|end|结束/i.test(x)) ||
          lines.find((x) => /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(x)) ||
          ""

        let title = lines[0] || ""
        let course = lines.find((x) => /课程|班级|course|class/i.test(x)) || ""
        if (!course && lines.length >= 2) {
          course = lines[1]
        }

        title = title.replace(/^(待办|todo)[:：]?\s*/i, "").trim()
        course = course.replace(/^(课程|班级|course|class)[:：]?\s*/i, "").trim()
        const deadline = deadlineLine.replace(/^(截止时间|结束时间|deadline|due)[:：]?\s*/i, "").trim()

        if (!title || !deadline) return null
        return { title, course, deadline }
      }

      const selectors = [
        ".todo-item",
        ".task-item",
        ".work-item",
        ".assignment-item",
        ".pending-item",
        ".el-card",
        ".ant-card",
        "tr",
        "li",
      ]

      const list = []
      const used = new Set()
      for (const sel of selectors) {
        const nodes = Array.from(document.querySelectorAll(sel))
        for (const node of nodes) {
          const item = parseOne(node)
          if (!item) continue
          const key = `${item.title}|${item.course}|${item.deadline}`
          if (used.has(key)) continue
          used.add(key)
          list.push(item)
        }
      }
      return list
    })
    .catch(() => [])

  return Array.isArray(rows) ? rows : []
}

async function collectTodoItemsViaApi(context) {
  const records = []
  const handler = async (response) => {
    const url = response.url()
    if (!/todo|task|assignment|work|pending|daiban|deadline|ddl/i.test(url)) return
    const ct = (response.headers() && response.headers()["content-type"]) || ""
    if (!/json/i.test(String(ct))) return
    try {
      const data = await response.json()
      records.push({ url, data })
    } catch (_) {}
  }

  const pages = context.pages()
  for (const p of pages) p.on("response", handler)
  await new Promise((resolve) => setTimeout(resolve, 2600))
  for (const p of pages) p.off("response", handler)

  const items = []
  const pushByKeys = (obj) => {
    if (!obj || typeof obj !== "object") return
    const title = toText(obj.title || obj.taskName || obj.name || obj.homeworkName || obj.workName || obj.bt)
    const course = toText(obj.course || obj.courseName || obj.className || obj.kcmc || obj.kc)
    const deadline = toText(obj.deadline || obj.endTime || obj.dueTime || obj.jzsj || obj.endDate || obj.jzrq)
    if (title && deadline) {
      items.push({ title, course, deadline })
    }
  }

  const walk = (val) => {
    if (Array.isArray(val)) {
      for (const it of val) walk(it)
      return
    }
    if (!val || typeof val !== "object") return
    pushByKeys(val)
    for (const k of Object.keys(val)) walk(val[k])
  }

  for (const rec of records) walk(rec.data)
  return items
}

function normalizeDdlItems(items) {
  const map = new Map()
  for (const item of items || []) {
    const title = toText(item.title)
    const course = toText(item.course)
    const deadline = toText(item.deadline).replace(/[./]/g, "-")
    if (!title || !deadline) continue
    const key = `${title}|${course}|${deadline}`
    if (map.has(key)) continue
    map.set(key, { title, course, deadline })
  }
  return Array.from(map.values())
}

async function run() {
  const browser = await launchBrowser()
  const context = await browser.newContext()
  const page = await context.newPage()

  const result = {
    meta: {
      entry: ENTRY_URL,
      fetchedAt: nowIso(),
      headless: HEADLESS,
      source: "lms-ddl-crawler",
    },
    items: [],
  }

  try {
    const openResult = await openCasFromLmsEntry(page, context)
    let lmsPage = openResult.lmsPage || null

    if (openResult.needsLogin) {
      if (DEBUG && openResult.casPage) {
        console.log(`[syxt-ddl-crawler] CAS page: ${openResult.casPage.url()}`)
      }
      lmsPage = await autoLoginCas(openResult.casPage, context)
      if (DEBUG && lmsPage) {
        console.log(`[syxt-ddl-crawler] Back to LMS: ${lmsPage.url()}`)
      }
    }

    if (!lmsPage) throw new Error("Could not reach LMS page after login flow.")

    await lmsPage.waitForLoadState("domcontentloaded", { timeout: WAIT_MS }).catch(() => {})
    await lmsPage.waitForTimeout(1800).catch(() => {})

    const domItems = await collectTodoItemsViaDom(lmsPage).catch(() => [])
    const apiItems = await collectTodoItemsViaApi(context).catch(() => [])
    const merged = normalizeDdlItems([...(domItems || []), ...(apiItems || [])])

    result.items = merged
    result.meta.count = merged.length
    result.meta.currentUrl = lmsPage.url()

    ensureDir(OUTPUT_PATH)
    fs.writeFileSync(path.resolve(OUTPUT_PATH), JSON.stringify(result, null, 2), "utf-8")
    console.log(`[syxt-ddl-crawler] Done. Output: ${path.resolve(OUTPUT_PATH)} (count=${merged.length})`)
  } catch (err) {
    result.error = clip(err && err.message ? err.message : "unknown error")
    ensureDir(OUTPUT_PATH)
    fs.writeFileSync(path.resolve(OUTPUT_PATH), JSON.stringify(result, null, 2), "utf-8")
    console.error(`[syxt-ddl-crawler] Failed: ${result.error}`)
    process.exitCode = 1
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

run()

