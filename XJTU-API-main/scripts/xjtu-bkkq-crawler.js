#!/usr/bin/env node
/*
 * XJTU attendance crawler (bkkq)
 * Flow:
 *   1) open http://bkkq.xjtu.edu.cn/
 *   2) jump to CAS login and submit stuId/password
 *   3) wait page stable
 *   4) open "课程考勤详情"
 *   5) switch to "本学期"
 *   6) crawl table rows under:
 *      课程名称 / 应到 / 实到 / 正常 / 迟到 / 请假 / 缺勤 / 到课率
 */

"use strict"

const fs = require("fs")
const path = require("path")
require("dotenv").config()

let chromium
try {
  ;({ chromium } = require("playwright"))
} catch (err) {
  console.error("[bkkq-crawler] Playwright not found. Run: npm i playwright")
  process.exit(1)
}

const ENTRY_URL = process.env.XJTU_BKKQ_ENTRY || "http://bkkq.xjtu.edu.cn/"
const OUTPUT_PATH = process.env.XJTU_BKKQ_OUTPUT || "./output/xjtu-bkkq-attendance.json"
const USERNAME = process.env.XJTU_BKKQ_USER || process.env.XJTU_EHALL_USER || process.env.XJTU_USER || ""
const PASSWORD = process.env.XJTU_BKKQ_PASS || process.env.XJTU_EHALL_PASS || process.env.XJTU_PASS || ""
const WAIT_MS = Number(process.env.XJTU_BKKQ_WAIT_MS || process.env.XJTU_WAIT_MS || 60000)
const HEADLESS = (process.env.XJTU_BKKQ_HEADLESS || process.env.XJTU_HEADLESS || "true").toLowerCase() !== "false"
const DEBUG = (process.env.XJTU_BKKQ_DEBUG || process.env.XJTU_DEBUG || "false").toLowerCase() === "true"
const BROWSER_PATH = process.env.XJTU_BKKQ_BROWSER_PATH || process.env.XJTU_BROWSER_PATH || ""
const DETAIL_ENTRY_WAIT_MS = Number(process.env.XJTU_BKKQ_DETAIL_ENTRY_WAIT_MS || 90000)
const DETAIL_CLICK_TIMEOUT_MS = Number(process.env.XJTU_BKKQ_DETAIL_CLICK_TIMEOUT_MS || 90000)
const TERM_SWITCH_TIMEOUT_MS = Number(process.env.XJTU_BKKQ_TERM_SWITCH_TIMEOUT_MS || 90000)

const TEXT_COURSE_ATTENDANCE_DETAIL = "\u8bfe\u7a0b\u8003\u52e4\u8be6\u60c5"
const TEXT_CURRENT_TERM = "\u672c\u5b66\u671f"
const ATTENDANCE_TAB_TARGETS = [
  { key: "week", id: "tab-week", label: "\u672c\u5468" },
  { key: "month", id: "tab-month", label: "\u672c\u6708" },
  { key: "term", id: "tab-term", label: "\u672c\u5b66\u671f" },
]

async function dumpDebugPage(page, label) {
  if (!DEBUG || !page || (typeof page.isClosed === "function" && page.isClosed())) return
  try {
    const htmlPath = path.resolve("./output", `${label}.html`)
    const pngPath = path.resolve("./output", `${label}.png`)
    ensureDir(htmlPath)
    fs.writeFileSync(htmlPath, await page.content(), "utf-8")
    await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {})
  } catch (_) {}
}

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

function clip(v, n = 500) {
  const t = toText(v)
  if (t.length <= n) return t
  return `${t.slice(0, n)}...`
}

function toCount(v, fallback = 0) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.trunc(v))
  }
  const text = toText(v)
  if (!text) return fallback
  const m = text.match(/-?\d+/)
  if (!m) return fallback
  const n = Number(m[0])
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback
}

function toRate(v) {
  const text = toText(v)
  if (!text) return ""
  const match = text.match(/-?\d+(?:\.\d+)?\s*%?/)
  if (match) {
    const normalized = String(match[0]).replace(/\s+/g, "")
    return normalized.endsWith("%") ? normalized : `${normalized}%`
  }
  return text
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const t = toText(v)
    if (t) return t
  }
  return ""
}

function looksLikeCasUrl(rawUrl) {
  const url = toText(rawUrl).toLowerCase()
  return url.includes("login.xjtu.edu.cn") || url.includes("/cas/")
}

function looksLikeBkkqUrl(rawUrl) {
  const url = toText(rawUrl).toLowerCase()
  return url.includes("bkkq.xjtu.edu.cn")
}

function isLikelyAttendanceApi(url) {
  return /bkkq|attendance|attend|kq|course|detail|term|list|query/i.test(String(url || ""))
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
    console.log(`[bkkq-crawler] Browser launched. headless=${HEADLESS}`)
    console.log(
      `[bkkq-crawler] wait config: entryReady=${DETAIL_ENTRY_WAIT_MS}ms, detailClick=${DETAIL_CLICK_TIMEOUT_MS}ms`
    )
  }
  return browser
}

async function clickFirstVisible(page, selectors, timeoutMs = 1800) {
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

async function fillFirstVisible(page, selectors, value, timeoutMs = 1800) {
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

async function clickAcrossPages(context, selectors, timeoutMs = 1800) {
  const pages = context.pages().slice().reverse()
  for (const p of pages) {
    const clicked = await clickFirstVisible(p, selectors, timeoutMs).catch(() => false)
    if (clicked) return p
  }
  return null
}

async function waitForPage(context, predicate, timeoutMs = 10000) {
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

async function waitForAnySelector(context, selectors, timeoutMs = 15000, intervalMs = 400) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pages = context.pages().slice().reverse()
    for (const page of pages) {
      for (const selector of selectors || []) {
        const count = await page.locator(selector).count().catch(() => 0)
        if (count > 0) return page
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return null
}

async function waitForPageStable(page, timeoutMs = 15000) {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => {})
  let stableTicks = 0
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const busy = await page
      .evaluate(() => {
        const selectors = [
          ".loading",
          ".loader",
          ".ant-spin-spinning",
          ".el-loading-mask",
          ".el-loading-spinner",
          ".van-loading",
          ".bh-loader",
          ".bh-loading",
        ]
        const visible = (el) => {
          if (!el) return false
          const style = window.getComputedStyle(el)
          if (!style) return false
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
            return false
          }
          return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        }
        for (const sel of selectors) {
          const nodes = Array.from(document.querySelectorAll(sel))
          if (nodes.some((n) => visible(n))) return true
        }
        const bodyText = String(document.body && document.body.innerText ? document.body.innerText : "")
        if (/加载中|请稍后|正在加载|Loading/i.test(bodyText)) return true
        return false
      })
      .catch(() => false)

    if (!busy) {
      stableTicks += 1
      if (stableTicks >= 3) return true
    } else {
      stableTicks = 0
    }
    await page.waitForTimeout(350).catch(() => {})
  }
  return false
}

async function waitForAttendanceEntryReady(context, page, timeoutMs = DETAIL_ENTRY_WAIT_MS) {
  const selectors = [
    `text=${TEXT_COURSE_ATTENDANCE_DETAIL}`,
    `a:has-text('${TEXT_COURSE_ATTENDANCE_DETAIL}')`,
    `button:has-text('${TEXT_COURSE_ATTENDANCE_DETAIL}')`,
    `div:has-text('${TEXT_COURSE_ATTENDANCE_DETAIL}')`,
    `span:has-text('${TEXT_COURSE_ATTENDANCE_DETAIL}')`,
  ]

  const matchedPage = await waitForAnySelector(context, selectors, timeoutMs, 450)
  if (matchedPage) return matchedPage
  return page
}

function createApiCollector(context) {
  const records = []
  const pageListeners = new Map()
  const maxRecords = 160

  const onResponse = async (response) => {
    const url = response.url()
    if (!isLikelyAttendanceApi(url)) return
    const headers = response.headers() || {}
    const contentType = String(headers["content-type"] || headers["Content-Type"] || "")
    if (!/json/i.test(contentType)) return

    try {
      const data = await response.json()
      records.push({
        url,
        status: Number(response.status() || 0),
        data,
      })
      if (records.length > maxRecords) {
        records.splice(0, records.length - maxRecords)
      }
    } catch (_) {}
  }

  const attach = (page) => {
    if (!page || pageListeners.has(page)) return
    page.on("response", onResponse)
    pageListeners.set(page, onResponse)
  }

  for (const page of context.pages()) attach(page)
  const onPage = (page) => attach(page)
  context.on("page", onPage)

  return {
    get() {
      return records.slice()
    },
    stop() {
      context.off("page", onPage)
      for (const [page, listener] of pageListeners.entries()) page.off("response", listener)
      pageListeners.clear()
    },
  }
}

async function openEntryAndReachCasOrBkkq(page, context) {
  await page.goto(ENTRY_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS })
  await page.waitForTimeout(900).catch(() => {})

  const casPage = await waitForPage(context, looksLikeCasUrl, 8000)
  if (casPage) return { needLogin: true, casPage, bkkqPage: null }

  const bkkqPage = await waitForPage(context, looksLikeBkkqUrl, 5000)
  if (bkkqPage && !looksLikeCasUrl(bkkqPage.url())) {
    return { needLogin: false, casPage: null, bkkqPage }
  }

  const loginSelectors = [
    "a[href*='login.xjtu.edu.cn']",
    "a[href*='/cas/']",
    "a:has-text('Login')",
    "button:has-text('Login')",
    "text=Login",
    "a:has-text('登录')",
    "button:has-text('登录')",
    "a:has-text('用户登录')",
    "button:has-text('用户登录')",
    "a:has-text('登录入口')",
    "button:has-text('登录入口')",
  ]
  await clickAcrossPages(context, loginSelectors, 2200).catch(() => null)

  const casAfterClick = await waitForPage(context, looksLikeCasUrl, WAIT_MS)
  if (casAfterClick) return { needLogin: true, casPage: casAfterClick, bkkqPage: null }

  const bkkqAfterClick = await waitForPage(context, looksLikeBkkqUrl, 6000)
  if (bkkqAfterClick) return { needLogin: false, casPage: null, bkkqPage: bkkqAfterClick }

  throw new Error("Could not reach CAS or bkkq page from entry.")
}

function getCasSelectors() {
  return {
    user: [
      "input[name='username']",
      "input[name='userName']",
      "input#username",
      "input[type='text']",
      "input[placeholder*='学号']",
      "input[placeholder*='账号']",
      "input[placeholder*='用户名']",
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
      "#login_submit",
      "button:has-text('登录')",
      "button:has-text('Login')",
      "input[type='submit']",
    ],
  }
}

async function autoLoginCas(casPage, context) {
  if (!USERNAME || !PASSWORD) {
    throw new Error("Missing credentials. Set XJTU_BKKQ_USER/XJTU_BKKQ_PASS.")
  }
  const selectors = getCasSelectors()
  const filledUser = await fillFirstVisible(casPage, selectors.user, USERNAME, 2200)
  const filledPass = await fillFirstVisible(casPage, selectors.pass, PASSWORD, 2200)
  if (!filledUser || !filledPass) {
    throw new Error(`Could not fill CAS credentials. currentUrl=${casPage.url()}`)
  }
  const clickedSubmit = await clickFirstVisible(casPage, selectors.submit, 2600)
  if (!clickedSubmit) throw new Error("Could not find CAS login submit button.")

  const bkkqPage = await waitForPage(context, looksLikeBkkqUrl, WAIT_MS)
  if (!bkkqPage) throw new Error("CAS submitted but did not return to bkkq in time.")
  return bkkqPage
}

async function chooseBestWorkingPage(context, preferredPage) {
  if (preferredPage && !preferredPage.isClosed()) return preferredPage
  const pages = context.pages().slice().reverse()
  for (const p of pages) {
    if (!p.isClosed()) return p
  }
  return preferredPage
}

async function openCourseAttendanceDetail(context, basePage, timeoutMs = DETAIL_CLICK_TIMEOUT_MS) {
  const before = new Set(context.pages())
  const selectors = [
    `text=${TEXT_COURSE_ATTENDANCE_DETAIL}`,
    `a:has-text('${TEXT_COURSE_ATTENDANCE_DETAIL}')`,
    `button:has-text('${TEXT_COURSE_ATTENDANCE_DETAIL}')`,
    `div:has-text('${TEXT_COURSE_ATTENDANCE_DETAIL}')`,
    `span:has-text('${TEXT_COURSE_ATTENDANCE_DETAIL}')`,
  ]

  const start = Date.now()
  let clicked = false
  while (Date.now() - start < timeoutMs) {
    await waitForPageStable(basePage, 8000).catch(() => {})
    clicked = await clickFirstVisible(basePage, selectors, 2500).catch(() => false)
    if (!clicked) {
      const crossClicked = await clickAcrossPages(context, selectors, 2500)
      clicked = !!crossClicked
    }
    if (clicked) break
    await basePage.waitForTimeout(900).catch(() => {})
  }
  if (!clicked) throw new Error(`Could not click "${TEXT_COURSE_ATTENDANCE_DETAIL}".`)

  await basePage.waitForTimeout(800).catch(() => {})
  const pages = context.pages()
  for (const p of pages) {
    if (!before.has(p)) {
      await p.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {})
      return p
    }
  }
  const latest = await chooseBestWorkingPage(context, basePage)
  await latest.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {})
  return latest
}

async function isCurrentTermSelected(context, page) {
  const pages = [page, ...context.pages().slice().reverse()].filter(Boolean)
  const visited = new Set()
  for (const p of pages) {
    if (visited.has(p)) continue
    visited.add(p)

    const roots = [p.mainFrame(), ...p.frames().filter((f) => f !== p.mainFrame())]
    for (const root of roots) {
      const confirmed = await root
        .evaluate((termText) => {
          const normalize = (v) => String(v || "").replace(/\s+/g, "").trim()
          const target = normalize(termText)
          if (!target) return false

          const isVisible = (el) => {
            if (!el) return false
            const style = window.getComputedStyle(el)
            if (!style) return false
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") <= 0) {
              return false
            }
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
          }

          const hasTargetText = (el) => {
            const value = normalize(
              el && ("value" in el ? el.value : "") ? el.value : el && (el.innerText || el.textContent || "")
            )
            return value.includes(target)
          }

          const isSelected = (el) => {
            const className = String((el && el.className) || "").toLowerCase()
            const ariaSelected = String((el && el.getAttribute && el.getAttribute("aria-selected")) || "").toLowerCase()
            const ariaCurrent = String((el && el.getAttribute && el.getAttribute("aria-current")) || "").toLowerCase()
            return (
              className.includes("active") ||
              className.includes("selected") ||
              className.includes("current") ||
              className.includes("is-active") ||
              ariaSelected === "true" ||
              ariaCurrent === "true"
            )
          }

          const termTabById = document.querySelector("#tab-term")
          if (termTabById && isVisible(termTabById)) {
            const ariaSelected = String(termTabById.getAttribute("aria-selected") || "").toLowerCase()
            const className = String(termTabById.className || "").toLowerCase()
            if (hasTargetText(termTabById) && (ariaSelected === "true" || className.includes("is-active") || className.includes("active"))) {
              return true
            }
          }

          const termTabByRole = Array.from(document.querySelectorAll("[role='tab']")).find(
            (el) => isVisible(el) && hasTargetText(el)
          )
          if (termTabByRole) {
            const ariaSelected = String(termTabByRole.getAttribute("aria-selected") || "").toLowerCase()
            const className = String(termTabByRole.className || "").toLowerCase()
            if (ariaSelected === "true" || className.includes("is-active") || className.includes("active")) return true
          }

          const selectedNodes = Array.from(
            document.querySelectorAll(
              "[role='tab'][aria-selected='true'], .active, .is-active, .selected, .current, .el-select-dropdown__item.selected"
            )
          )
          if (selectedNodes.some((el) => isVisible(el) && hasTargetText(el))) return true

          const valueNodes = Array.from(
            document.querySelectorAll(
              ".el-select .el-input__inner, .el-select .el-select__selected-item, .ant-select-selection-item, .ant-select-selector, input[placeholder*='学期'], input[readonly]"
            )
          )
          if (valueNodes.some((el) => isVisible(el) && hasTargetText(el))) return true

          const directNodes = Array.from(
            document.querySelectorAll("button, a, li, span, div, label, td, th, [role='tab'], [role='button']")
          ).filter((el) => isVisible(el) && hasTargetText(el))
          if (directNodes.some((el) => isSelected(el))) return true

          return false
        }, TEXT_CURRENT_TERM)
        .catch(() => false)

      if (confirmed) return true
    }
  }
  return false
}

async function switchToCurrentTerm(context, page, timeoutMs = TERM_SWITCH_TIMEOUT_MS) {
  const directSelectors = [
    "#tab-term",
    "[role='tab']#tab-term",
    `[role='tab']:has-text('${TEXT_CURRENT_TERM}')`,
    `.el-tabs__item:has-text('${TEXT_CURRENT_TERM}')`,
    `li[role='tab']:has-text('${TEXT_CURRENT_TERM}')`,
    `li.el-tabs__item:has-text('${TEXT_CURRENT_TERM}')`,
    `.el-select-dropdown__item:has-text('${TEXT_CURRENT_TERM}')`,
    `li:has-text('${TEXT_CURRENT_TERM}')`,
    `button:has-text('${TEXT_CURRENT_TERM}')`,
    `a:has-text('${TEXT_CURRENT_TERM}')`,
  ]

  const start = Date.now()
  let clicked = false
  let attempts = 0
  while (Date.now() - start < timeoutMs) {
    attempts += 1
    const workingPage = (await chooseBestWorkingPage(context, page)) || page

    const alreadySelected = await isCurrentTermSelected(context, workingPage)
    if (alreadySelected) return { clicked, confirmed: true, attempts }

    await waitForPageStable(workingPage, 8000).catch(() => {})
    let clickedThisRound = false

    const clickedDirect = await clickFirstVisible(workingPage, directSelectors, 2200).catch(() => false)
    clickedThisRound = clickedThisRound || clickedDirect

    if (!clickedThisRound) {
      const clickedCross = await clickAcrossPages(context, directSelectors, 2200).catch(() => null)
      clickedThisRound = !!clickedCross
    }

    const openSelectors = [
      ".el-select",
      ".ant-select-selector",
      "input[placeholder*='学期']",
      "input[placeholder*='请选择']",
      "div:has-text('学期')",
      "span:has-text('学期')",
    ]

    if (!clickedThisRound) {
      const opened = await clickFirstVisible(workingPage, openSelectors, 1800).catch(() => false)
      if (!opened) {
        await clickAcrossPages(context, openSelectors, 1800).catch(() => null)
      }
      await workingPage.waitForTimeout(300).catch(() => {})

      const clickedAfterOpen = await clickFirstVisible(workingPage, directSelectors, 2200).catch(() => false)
      clickedThisRound = clickedThisRound || clickedAfterOpen
      if (!clickedThisRound) {
        const clickedCrossAfterOpen = await clickAcrossPages(context, directSelectors, 2200).catch(() => null)
        clickedThisRound = !!clickedCrossAfterOpen
      }
    }

    clicked = clicked || clickedThisRound
    await workingPage.waitForTimeout(clickedThisRound ? 700 : 500).catch(() => {})

    const confirmed = await isCurrentTermSelected(context, workingPage)
    if (confirmed) return { clicked, confirmed: true, attempts }
  }

  return { clicked, confirmed: false, attempts }
}

async function autoScroll(page) {
  await page
    .evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const pickScrollable = () => {
        const all = Array.from(document.querySelectorAll("div,section,main,body"))
        let best = null
        for (const el of all) {
          if (!el) continue
          const maxTop = (el.scrollHeight || 0) - (el.clientHeight || 0)
          if (maxTop <= 60) continue
          if (!best || maxTop > (best.scrollHeight - best.clientHeight)) best = el
        }
        return best || document.scrollingElement || document.documentElement || document.body
      }

      const scroller = pickScrollable()
      const maxTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0))
      if (maxTop <= 0) return

      const steps = 10
      for (let i = 1; i <= steps; i++) {
        const nextTop = Math.floor((maxTop * i) / steps)
        scroller.scrollTo(0, nextTop)
        await sleep(120)
      }
      await sleep(180)
      scroller.scrollTo(0, 0)
      await sleep(120)
    })
    .catch(() => {})
}

async function waitForAttendanceRows(page, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const domItems = await collectAttendanceFromDom(page).catch(() => [])
    if (Array.isArray(domItems) && domItems.length) return true
    await page.waitForTimeout(600).catch(() => {})
  }
  return false
}

async function clickAttendanceTab(context, page, tab) {
  if (!tab || !tab.label) return false
  const selectors = [
    tab.id ? `#${tab.id}` : "",
    tab.id ? `[role='tab']#${tab.id}` : "",
    `[role='tab']:has-text('${tab.label}')`,
    `.el-tabs__item:has-text('${tab.label}')`,
    `li[role='tab']:has-text('${tab.label}')`,
    `li.el-tabs__item:has-text('${tab.label}')`,
  ].filter(Boolean)
  const clicked = await clickFirstVisible(page, selectors, 2200).catch(() => false)
  if (clicked) return true
  const cross = await clickAcrossPages(context, selectors, 2200).catch(() => null)
  return !!cross
}

async function isAttendanceTabSelected(context, page, tab) {
  if (!tab || !tab.label) return false
  const pages = [page, ...context.pages().slice().reverse()].filter(Boolean)
  const visited = new Set()
  for (const p of pages) {
    if (visited.has(p)) continue
    visited.add(p)
    const roots = [p.mainFrame(), ...p.frames().filter((f) => f !== p.mainFrame())]
    for (const root of roots) {
      const ok = await root
        .evaluate((payload) => {
          const text = (v) => String(v || "").replace(/\s+/g, "").trim()
          const target = text(payload && payload.label)
          const id = text(payload && payload.id)
          if (!target) return false

          const visible = (el) => {
            if (!el) return false
            const style = window.getComputedStyle(el)
            if (!style) return false
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") <= 0) {
              return false
            }
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
          }

          const isActive = (el) => {
            if (!el || !visible(el)) return false
            const ariaSelected = String(el.getAttribute && el.getAttribute("aria-selected") || "").toLowerCase()
            const className = String(el.className || "").toLowerCase()
            return ariaSelected === "true" || className.includes("is-active") || className.includes("active")
          }

          if (id) {
            const byId = document.getElementById(id)
            if (byId) {
              const value = text(byId.innerText || byId.textContent || "")
              if (value.includes(target) && isActive(byId)) return true
            }
          }

          const tabs = Array.from(document.querySelectorAll("[role='tab'], .el-tabs__item"))
          for (const el of tabs) {
            const value = text(el.innerText || el.textContent || "")
            if (!value.includes(target)) continue
            if (isActive(el)) return true
          }
          return false
        }, { id: tab.id || "", label: tab.label })
        .catch(() => false)

      if (ok) return true
    }
  }
  return false
}

async function switchAttendanceTab(context, page, tab, timeoutMs = 45000) {
  const start = Date.now()
  let clicked = false
  let attempts = 0
  while (Date.now() - start < timeoutMs) {
    attempts += 1
    const workingPage = (await chooseBestWorkingPage(context, page)) || page
    const selected = await isAttendanceTabSelected(context, workingPage, tab)
    if (selected) return { clicked, confirmed: true, attempts }

    await waitForPageStable(workingPage, 7000).catch(() => {})
    const clickedThisRound = await clickAttendanceTab(context, workingPage, tab)
    clicked = clicked || !!clickedThisRound
    await workingPage.waitForTimeout(clickedThisRound ? 800 : 500).catch(() => {})

    const confirmed = await isAttendanceTabSelected(context, workingPage, tab)
    if (confirmed) return { clicked, confirmed: true, attempts }
  }
  return { clicked, confirmed: false, attempts }
}

async function collectSummaryCards(page) {
  const roots = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())]
  for (const root of roots) {
    const summary = await root
      .evaluate(() => {
        const text = (v) => String(v || "").replace(/\s+/g, " ").trim()
        const toCount = (v) => {
          const m = text(v).match(/-?\d+/)
          if (!m) return 0
          const n = Number(m[0])
          return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
        }

        const labels = [
          ["应到", "shouldAttend"],
          ["正常", "normalCount"],
          ["迟到", "late"],
          ["请假", "leave"],
          ["缺勤", "absences"],
        ]
        const out = {
          shouldAttend: 0,
          normalCount: 0,
          late: 0,
          leave: 0,
          absences: 0,
        }

        const cards = Array.from(document.querySelectorAll(".card, .grid-content, .panel-body .flex-1"))
        for (const card of cards) {
          const t = text(card.innerText || card.textContent || "")
          if (!t) continue
          for (const pair of labels) {
            const label = pair[0]
            const key = pair[1]
            if (!t.includes(label)) continue
            const m = t.match(new RegExp(`${label}\\s*([0-9]+)`))
            const value = m && m[1] ? Number(m[1]) : toCount(t)
            if (value > 0 || t.includes("0")) out[key] = value
          }
        }

        const hasAny = Object.keys(out).some((k) => out[k] > 0)
        return { ...out, hasAny }
      })
      .catch(() => null)
    if (summary && typeof summary === "object") return summary
  }
  return null
}

async function collectAttendanceFromDomWithTerm(page, termLabel = TEXT_CURRENT_TERM) {
  const items = await collectAttendanceFromDom(page).catch(() => [])
  return (items || []).map((item) => ({
    ...item,
    term: toText(item.term) || toText(termLabel) || TEXT_CURRENT_TERM,
  }))
}

async function collectRawTables(page) {
  const roots = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())]
  const allTables = []
  for (const root of roots) {
    const tables = await root
      .evaluate(() => {
        const text = (v) => String(v || "").replace(/\s+/g, " ").trim()
        const out = []
        const tableNodes = Array.from(document.querySelectorAll("table"))
        for (const table of tableNodes) {
          const headers = Array.from(table.querySelectorAll("thead th, thead td"))
            .map((el) => text(el.innerText || el.textContent || ""))
            .filter(Boolean)
          const bodyRows = Array.from(table.querySelectorAll("tbody tr"))
          const rows = (bodyRows.length ? bodyRows : Array.from(table.querySelectorAll("tr")))
            .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => text(td.innerText || td.textContent || "")))
            .filter((row) => row && row.length && row.some((cell) => cell))
          if (!headers.length && !rows.length) continue
          out.push({ headers, rows })
        }
        return out
      })
      .catch(() => [])
    if (Array.isArray(tables) && tables.length) {
      allTables.push(...tables)
    }
  }
  return allTables
}

function normalizeAttendanceItems(items) {
  const map = new Map()
  for (const raw of items || []) {
    const courseName = toText(raw.courseName || raw.course || raw.kcmc)
    if (!courseName) continue

    const teacher = toText(raw.teacher || raw.jsxm || raw.instructor)
    const term = toText(raw.term || raw.termName) || "本学期"
    const shouldAttend = toCount(raw.shouldAttend || raw.yingdao || raw.totalCount || raw.totalClasses)
    const actualAttend = toCount(raw.actualAttend || raw.shidao || raw.presentCount || raw.attendedCount)
    const normalCount = toCount(raw.normal || raw.zhengchang || raw.normalCount)
    const late = toCount(raw.late || raw.chidao || raw.cd || raw.lateCount)
    const leave = toCount(raw.leave || raw.qingjia || raw.qj || raw.leaveCount)
    const absences = toCount(raw.absences || raw.absent || raw.queqin || raw.qq || raw.missed)
    const attendanceRate = toRate(raw.attendanceRate || raw.daoKelv || raw.rate || raw.presentRate)
    const rawText = toText(raw.raw || "")

    const key = [
      courseName,
      term,
      shouldAttend,
      actualAttend,
      normalCount,
      late,
      leave,
      absences,
      attendanceRate,
    ].join("|")
    if (map.has(key)) continue

    map.set(key, {
      id: "",
      courseName,
      teacher,
      term,
      shouldAttend,
      actualAttend,
      normalCount,
      late,
      leave,
      absences,
      attendanceRate,
      raw: rawText,
    })
  }

  return Array.from(map.values())
    .sort((a, b) => {
      const c = String(a.courseName).localeCompare(String(b.courseName), "zh-Hans-CN")
      if (c !== 0) return c
      return String(a.term).localeCompare(String(b.term), "zh-Hans-CN")
    })
    .map((item, index) => ({
      ...item,
      id: `att-${index + 1}`,
    }))
}

async function collectAttendanceFromDom(page) {
  const evalInRoot = async (root) => {
    return root
      .evaluate(() => {
      const text = (v) => String(v || "").replace(/\s+/g, " ").trim()
      const toCount = (v) => {
        const s = text(v)
        if (!s) return 0
        const m = s.match(/-?\d+/)
        if (!m) return 0
        const n = Number(m[0])
        return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
      }
      const toRate = (v) => {
        const s = String(v || "").replace(/\s+/g, "").trim()
        if (!s) return ""
        const m = s.match(/-?\d+(?:\.\d+)?%?/)
        if (!m) return s
        return m[0].endsWith("%") ? m[0] : `${m[0]}%`
      }

      const aliases = {
        courseName: ["课程名称", "课程", "课程名", "course"],
        shouldAttend: ["应到", "应到次数", "应到人次", "应签到"],
        actualAttend: ["实到", "实到次数", "实到人次", "实签到"],
        normalCount: ["正常", "正常次数", "正常签到"],
        late: ["迟到", "迟到次数"],
        leave: ["请假", "请假次数"],
        absences: ["缺勤", "缺勤次数", "旷课", "缺课"],
        attendanceRate: ["到课率", "出勤率"],
      }
      const headerToField = (h) => {
        const hs = text(h).toLowerCase()
        if (!hs) return ""
        for (const key of Object.keys(aliases)) {
          if ((aliases[key] || []).some((alias) => hs.includes(String(alias).toLowerCase()))) return key
        }
        return ""
      }

      const out = []
      const seen = new Set()
      const pushUnique = (item) => {
        if (!item || !text(item.courseName)) return
        const key = [
          text(item.courseName),
          toCount(item.shouldAttend),
          toCount(item.actualAttend),
          toCount(item.normal),
          toCount(item.late),
          toCount(item.leave),
          toCount(item.absences),
          toRate(item.attendanceRate),
        ].join("|")
        if (seen.has(key)) return
        seen.add(key)
        out.push(item)
      }

      // Strategy A: generic table parse (header + body in same table)
      const tables = Array.from(document.querySelectorAll("table"))
      for (const table of tables) {
        const headerRow =
          table.querySelector("thead tr") ||
          Array.from(table.querySelectorAll("tr")).find((tr) => tr.querySelectorAll("th").length > 0)
        if (!headerRow) continue

        const headerCells = Array.from(headerRow.querySelectorAll("th,td"))
        if (!headerCells.length) continue
        const colMap = []
        headerCells.forEach((cell, idx) => {
          const field = headerToField(cell.innerText || cell.textContent || "")
          if (field) colMap.push({ idx, field })
        })
        if (!colMap.length) continue
        if (!colMap.some((m) => m.field === "courseName")) continue

        let bodyRows = Array.from(table.querySelectorAll("tbody tr"))
        if (!bodyRows.length) {
          bodyRows = Array.from(table.querySelectorAll("tr")).filter((tr) => tr !== headerRow)
        }

        for (const tr of bodyRows) {
          const tds = Array.from(tr.querySelectorAll("td"))
          if (!tds.length) continue
          const item = {
            courseName: "",
            shouldAttend: 0,
            actualAttend: 0,
            normal: 0,
            late: 0,
            leave: 0,
            absences: 0,
            attendanceRate: "",
            raw: text(tr.innerText || tr.textContent || ""),
          }
          for (const col of colMap) {
            const td = tds[col.idx]
            if (!td) continue
            const val = text(td.innerText || td.textContent || "")
            if (!val) continue
            if (col.field === "courseName") item.courseName = val
            if (col.field === "shouldAttend") item.shouldAttend = toCount(val)
            if (col.field === "actualAttend") item.actualAttend = toCount(val)
            if (col.field === "normalCount") item.normal = toCount(val)
            if (col.field === "late") item.late = toCount(val)
            if (col.field === "leave") item.leave = toCount(val)
            if (col.field === "absences") item.absences = toCount(val)
            if (col.field === "attendanceRate") item.attendanceRate = toRate(val)
          }
          if (!item.courseName) continue

          pushUnique(item)
        }
      }

      // Strategy B: ElementUI split table structure (header/body wrappers share column class prefix)
      const wrappers = Array.from(document.querySelectorAll(".el-table"))
      for (const wrapper of wrappers) {
        const headerCells = Array.from(wrapper.querySelectorAll(".el-table__header-wrapper th"))
        if (!headerCells.length) continue

        const colClassToField = {}
        for (const th of headerCells) {
          const className = String(th.className || "")
          const m = className.match(/(el-table_\d+_column_\d+)/)
          if (!m) continue
          const colClass = m[1]
          const label = text(th.innerText || th.textContent || "")
          const field = headerToField(label)
          if (field) colClassToField[colClass] = field
        }

        const hasCourseName = Object.keys(colClassToField).some((k) => colClassToField[k] === "courseName")
        if (!hasCourseName) continue

        const bodyRows = Array.from(wrapper.querySelectorAll(".el-table__body-wrapper tbody tr.el-table__row"))
        for (const tr of bodyRows) {
          const tds = Array.from(tr.querySelectorAll("td"))
          if (!tds.length) continue
          const item = {
            courseName: "",
            shouldAttend: 0,
            actualAttend: 0,
            normal: 0,
            late: 0,
            leave: 0,
            absences: 0,
            attendanceRate: "",
            raw: text(tr.innerText || tr.textContent || ""),
          }

          for (const td of tds) {
            const className = String(td.className || "")
            const m = className.match(/(el-table_\d+_column_\d+)/)
            if (!m) continue
            const field = colClassToField[m[1]]
            if (!field) continue
            const val = text(td.innerText || td.textContent || "")
            if (!val) continue
            if (field === "courseName") item.courseName = val
            if (field === "shouldAttend") item.shouldAttend = toCount(val)
            if (field === "actualAttend") item.actualAttend = toCount(val)
            if (field === "normalCount") item.normal = toCount(val)
            if (field === "late") item.late = toCount(val)
            if (field === "leave") item.leave = toCount(val)
            if (field === "absences") item.absences = toCount(val)
            if (field === "attendanceRate") item.attendanceRate = toRate(val)
          }

          pushUnique(item)
        }
      }
      return out
    })
      .catch(() => [])
  }

  const roots = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())]
  const merged = []
  for (const root of roots) {
    const rows = await evalInRoot(root)
    if (Array.isArray(rows) && rows.length) {
      merged.push(...rows)
    }
  }
  return Array.isArray(merged) ? merged : []
}

function collectAttendanceFromApi(records) {
  const out = []
  const seen = new Set()

  const toItemFromObject = (obj) => {
    if (!obj || typeof obj !== "object") return null
    const courseName = firstNonEmpty(
      obj.courseName,
      obj.course,
      obj.courseTitle,
      obj.kcmc,
      obj.kc,
      obj.className,
      obj.kcName,
      obj.course_name,
      obj.course_title,
      obj.courseNameZh
    )
    if (!courseName) return null

    const teacher = firstNonEmpty(obj.teacher, obj.teacherName, obj.jsxm, obj.instructor, obj.teacher_name)
    const term = firstNonEmpty(obj.term, obj.termName, obj.xnxq, obj.semester, "本学期")
    const shouldAttend = toCount(
      firstNonEmpty(
        obj.shouldAttend,
        obj.totalCount,
        obj.totalClasses,
        obj.yingdao,
        obj.expectedCount,
        obj.should_count,
        obj.yd
      )
    )
    const actualAttend = toCount(
      firstNonEmpty(
        obj.actualAttend,
        obj.presentCount,
        obj.attendedCount,
        obj.shidao,
        obj.actualCount,
        obj.actual_count,
        obj.sd
      )
    )
    const normal = toCount(firstNonEmpty(obj.normal, obj.normalCount, obj.zhengchang, obj.normal_count, obj.zc))
    const late = toCount(firstNonEmpty(obj.late, obj.lateCount, obj.cdcs, obj.chidao, obj.late_count, obj.cd))
    const leave = toCount(firstNonEmpty(obj.leave, obj.leaveCount, obj.qjcs, obj.qingjia, obj.leave_count, obj.qj))
    const absences = toCount(
      firstNonEmpty(
        obj.absences,
        obj.absentCount,
        obj.qqcs,
        obj.missedCount,
        obj.queqin,
        obj.absent_count,
        obj.qq
      )
    )
    const attendanceRate = toRate(
      firstNonEmpty(
        obj.attendanceRate,
        obj.rate,
        obj.presentRate,
        obj.daoKelv,
        obj.attendance_rate,
        obj.dk_rate,
        obj.percent
      )
    )

    return {
      courseName,
      teacher,
      term,
      shouldAttend,
      actualAttend,
      normal,
      late,
      leave,
      absences,
      attendanceRate,
      raw: "",
    }
  }

  const pushItem = (item) => {
    if (!item || !item.courseName) return
    const key = [
      item.courseName,
      item.term,
      item.shouldAttend,
      item.actualAttend,
      item.normal,
      item.late,
      item.leave,
      item.absences,
      item.attendanceRate,
    ].join("|")
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }

  const walk = (val) => {
    if (Array.isArray(val)) {
      for (const it of val) walk(it)
      return
    }
    if (!val || typeof val !== "object") return
    const item = toItemFromObject(val)
    pushItem(item)
    for (const key of Object.keys(val)) walk(val[key])
  }

  for (const rec of records || []) {
    if (!rec || !rec.data) continue
    walk(rec.data)
  }

  return out
}

async function run() {
  const browser = await launchBrowser()
  const context = await browser.newContext()
  const page = await context.newPage()
  const apiCollector = createApiCollector(context)

  const result = {
    meta: {
      entry: ENTRY_URL,
      fetchedAt: nowIso(),
      headless: HEADLESS,
      source: "bkkq-attendance-crawler",
    },
    attendance: [],
    attendanceByTab: {},
    summary: {},
    raw: {},
  }

  try {
    if (DEBUG) {
      console.log(`[bkkq-crawler] Start. entry=${ENTRY_URL}`)
    }
    const openResult = await openEntryAndReachCasOrBkkq(page, context)
    let bkkqPage = openResult.bkkqPage || null

    if (openResult.needLogin) {
      if (DEBUG && openResult.casPage) {
        console.log(`[bkkq-crawler] CAS page: ${openResult.casPage.url()}`)
      }
      bkkqPage = await autoLoginCas(openResult.casPage, context)
    }
    if (!bkkqPage) throw new Error("Could not enter bkkq page.")
    await waitForPageStable(bkkqPage, 30000)
    bkkqPage = await waitForAttendanceEntryReady(context, bkkqPage, DETAIL_ENTRY_WAIT_MS)

    const detailPage = await openCourseAttendanceDetail(context, bkkqPage, DETAIL_CLICK_TIMEOUT_MS)
    await waitForPageStable(detailPage, 18000)

    const summary = (await collectSummaryCards(detailPage)) || {}
    const byTab = {}
    const allDomItems = []
    for (const tab of ATTENDANCE_TAB_TARGETS) {
      const switchedTab = await switchAttendanceTab(context, detailPage, tab, 45000)
      if (DEBUG) {
        console.log(
          `[bkkq-crawler] Tab switch "${tab.label}": confirmed=${!!(switchedTab && switchedTab.confirmed)}, clicked=${!!(
            switchedTab && switchedTab.clicked
          )}, attempts=${Number((switchedTab && switchedTab.attempts) || 0)}`
        )
      }
      await waitForPageStable(detailPage, 12000)
      await autoScroll(detailPage)
      await waitForAttendanceRows(detailPage, 20000)
      await detailPage.waitForTimeout(700).catch(() => {})

      const rows = await collectAttendanceFromDomWithTerm(detailPage, tab.label)
      byTab[tab.key] = normalizeAttendanceItems(rows || [])
      if (Array.isArray(rows) && rows.length) allDomItems.push(...rows)
    }

    const domItems = allDomItems
    const apiItems = collectAttendanceFromApi(apiCollector.get())
    const merged = normalizeAttendanceItems([...(domItems || []), ...(apiItems || [])])
    const rawTables = await collectRawTables(detailPage)

    if ((!merged || !merged.length) && DEBUG) {
      await dumpDebugPage(detailPage, "bkkq-detail-empty")
      console.log("[bkkq-crawler] No rows captured from DOM/API after entering current-term detail.")
    }

    result.attendance = merged
    result.attendanceByTab = byTab
    result.summary = summary
    result.raw = {
      domCount: (domItems || []).length,
      apiCount: (apiItems || []).length,
      apiCaptureCount: apiCollector.get().length,
      hasSummary: !!(summary && typeof summary === "object" && Object.keys(summary).length),
      tables: rawTables,
    }
    result.meta.count = merged.length
    result.meta.currentUrl = detailPage.url()
    result.meta.term = TEXT_CURRENT_TERM
    result.meta.apiCaptureCount = apiCollector.get().length

    ensureDir(OUTPUT_PATH)
    fs.writeFileSync(path.resolve(OUTPUT_PATH), JSON.stringify(result, null, 2), "utf-8")
    console.log(`[bkkq-crawler] Done. Output: ${path.resolve(OUTPUT_PATH)} (count=${merged.length})`)
  } catch (err) {
    result.error = clip(err && err.message ? err.message : "unknown error")
    ensureDir(OUTPUT_PATH)
    fs.writeFileSync(path.resolve(OUTPUT_PATH), JSON.stringify(result, null, 2), "utf-8")
    console.error(`[bkkq-crawler] Failed: ${result.error}`)
    process.exitCode = 1
  } finally {
    apiCollector.stop()
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

run()
