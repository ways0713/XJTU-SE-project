#!/usr/bin/env node
/*
 * XJTU Ehall crawler (local-run script)
 *
 * Manual login (recommended):
 *   $env:XJTU_HEADLESS="false"
 *   $env:XJTU_MANUAL_LOGIN="true"
 *   $env:XJTU_WAIT_MS="60000"
 *   $env:XJTU_DEBUG="true"
 *   npm run crawl:xjtu
 *
 * Monitor-only mode (record your manual actions):
 *   $env:XJTU_HEADLESS="false"
 *   $env:XJTU_MANUAL_LOGIN="true"
 *   $env:XJTU_TRACE_OPS="true"
 *   $env:XJTU_MONITOR_ONLY="true"
 *   $env:XJTU_DEBUG="true"
 *   npm run crawl:xjtu
 */

"use strict"

const fs = require("fs")
const path = require("path")
const readline = require("readline")
require("dotenv").config()

let chromium
try {
  ;({ chromium } = require("playwright"))
} catch (err) {
  console.error("[xjtu-crawler] Playwright not found. Run: npm i playwright")
  process.exit(1)
}

const ENTRY_URL = "https://ehall.xjtu.edu.cn"
const OUTPUT_PATH = process.env.XJTU_OUTPUT || "./output/xjtu-ehall.json"
const TARGET_ALL = "all"
const TARGET_COURSE = "course"
const TARGET_SCORE = "score"
const CRAWL_TARGET = String(process.env.XJTU_CRAWL_TARGET || TARGET_ALL)
  .trim()
  .toLowerCase()
const USERNAME = process.env.XJTU_EHALL_USER || process.env.XJTU_USER || ""
const PASSWORD = process.env.XJTU_EHALL_PASS || process.env.XJTU_PASS || ""
const HEADLESS = (process.env.XJTU_HEADLESS || "true").toLowerCase() !== "false"
const WAIT_MS = Number(process.env.XJTU_WAIT_MS || 15000)
const BROWSER_PATH = process.env.XJTU_BROWSER_PATH || ""
const BROWSER_CHANNEL = process.env.XJTU_BROWSER_CHANNEL || ""
const MANUAL_LOGIN = (process.env.XJTU_MANUAL_LOGIN || "false").toLowerCase() === "true"
const DEBUG_MODE = (process.env.XJTU_DEBUG || "false").toLowerCase() === "true"
const TRACE_OPS = (process.env.XJTU_TRACE_OPS || "false").toLowerCase() === "true"
const MONITOR_ONLY = (process.env.XJTU_MONITOR_ONLY || (TRACE_OPS ? "true" : "false")).toLowerCase() === "true"
const OPS_OUTPUT_PATH = process.env.XJTU_OPS_OUTPUT || "./output/xjtu-ops-log.json"
const MAX_OP_EVENTS = Number(process.env.XJTU_MAX_OP_EVENTS || 4000)
const MONITOR_WAIT_MS = Number(process.env.XJTU_MONITOR_WAIT_MS || 600000)

function normalizeTarget(target) {
  if (target === TARGET_COURSE || target === TARGET_SCORE || target === TARGET_ALL) return target
  return TARGET_ALL
}

const SAFE_CRAWL_TARGET = normalizeTarget(CRAWL_TARGET)

const TXT = {
  loginZh: "\u767b\u5f55",
  searchZh: "\u641c\u7d22",
  serviceZh: "\u670d\u52a1",
  appZh: "\u5e94\u7528",
  allServiceZh: "\u5168\u90e8\u670d\u52a1",
  appCenterZh: "\u5e94\u7528\u4e2d\u5fc3",
  serviceHallZh: "\u670d\u52a1\u5927\u5385",
  moreZh: "\u66f4\u591a",
  allZh: "\u5168\u90e8",
  enterServiceZh: "\u8fdb\u5165\u670d\u52a1",
  queryZh: "\u67e5\u8be2",
  studentZh: "\u5b66\u751f",
  studentGroupZh: "\u5b66\u751f\u7ec4",
  studentIdZh: "\u5b66\u53f7",
  accountZh: "\u8d26\u53f7",
  passwordZh: "\u5bc6\u7801",
  myCourseTableZh: "\u6211\u7684\u672c\u7814\u8bfe\u8868",
  courseTableZh: "\u8bfe\u8868",
  scoreQueryZh: "\u6210\u7ee9\u67e5\u8be2",
  postgradScoreQueryZh: "\u672c\u7814\u6210\u7ee9\u67e5\u8be2",
  scoreZh: "\u6210\u7ee9",
}

function ensureDir(filePath) {
  const dir = path.dirname(path.resolve(filePath))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function safeName(s) {
  return String(s || "")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "_")
    .slice(0, 80)
}

function nowIso() {
  return new Date().toISOString()
}

function clipText(s, maxLen = 200) {
  const t = String(s || "")
  return t.length > maxLen ? `${t.slice(0, maxLen)}...` : t
}

function readExistingOutput(filePath) {
  try {
    if (!fs.existsSync(path.resolve(filePath))) return null
    const raw = fs.readFileSync(path.resolve(filePath), "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch (_) {
    return null
  }
}

function pickFinalSection(target, currentResult, existingResult) {
  if (target === TARGET_COURSE) {
    return {
      course: currentResult.course,
      score: existingResult && Object.prototype.hasOwnProperty.call(existingResult, "score")
        ? existingResult.score
        : null,
    }
  }
  if (target === TARGET_SCORE) {
    return {
      course: existingResult && Object.prototype.hasOwnProperty.call(existingResult, "course")
        ? existingResult.course
        : null,
      score: currentResult.score,
    }
  }
  return {
    course: currentResult.course,
    score: currentResult.score,
  }
}

async function dumpDebugPage(page, label) {
  if (!page || (typeof page.isClosed === "function" && page.isClosed())) return false
  const htmlPath = path.resolve(`./output/${safeName(label)}.html`)
  const pngPath = path.resolve(`./output/${safeName(label)}.png`)
  ensureDir(htmlPath)
  try {
    fs.writeFileSync(htmlPath, await page.content(), "utf-8")
  } catch (_) {
    return false
  }
  await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {})
  return true
}

function waitForEnter(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(promptText, () => {
      rl.close()
      resolve()
    })
  })
}

function waitForKeyword(promptText, expectedKeyword) {
  const target = String(expectedKeyword || "").trim().toUpperCase()
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    const ask = () => {
      rl.question(promptText, (input) => {
        const got = String(input || "").trim().toUpperCase()
        if (got === target) {
          rl.close()
          resolve()
          return
        }
        ask()
      })
    }
    ask()
  })
}

async function captureMonitorCheckpoint(context, ops, index) {
  const pages = context.pages()
  const snapshots = []
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const title = await p.title().catch(() => "")
    const url = p.url()
    const label = `monitor-checkpoint-${index}-page-${i}`
    if (DEBUG_MODE) await dumpDebugPage(p, label)
    snapshots.push({ pageIndex: i, url, title, debugLabel: DEBUG_MODE ? label : "" })
  }
  if (ops) ops.push({ type: "monitor-checkpoint", checkpointIndex: index, pages: snapshots })
  return snapshots
}

function createOpsRecorder(config = {}) {
  const events = []
  const pageCleanup = new Map()

  function push(event) {
    if (!event) return
    const full = { at: nowIso(), ...event }
    events.push(full)
    if (events.length > (config.maxEvents || MAX_OP_EVENTS)) {
      events.splice(0, events.length - (config.maxEvents || MAX_OP_EVENTS))
    }
  }

  function attachPage(page, label = "page") {
    if (!page || pageCleanup.has(page)) return
    const listeners = []

    const onDomLoaded = () => push({ type: "domcontentloaded", label, url: page.url() })
    page.on("domcontentloaded", onDomLoaded)
    listeners.push(["domcontentloaded", onDomLoaded])

    const onLoad = () => push({ type: "load", label, url: page.url() })
    page.on("load", onLoad)
    listeners.push(["load", onLoad])

    const onNav = (frame) => {
      if (frame === page.mainFrame()) push({ type: "framenavigated", label, url: frame.url() })
    }
    page.on("framenavigated", onNav)
    listeners.push(["framenavigated", onNav])

    const onReq = (req) => {
      const u = req.url()
      if (!/appShow|openApp|ehall|jwxt|course|score|grade|kcb|chengji|cj/i.test(u)) return
      push({ type: "request", label, method: req.method(), url: u })
    }
    page.on("request", onReq)
    listeners.push(["request", onReq])

    const onRes = (res) => {
      const u = res.url()
      if (!/appShow|openApp|ehall|jwxt|course|score|grade|kcb|chengji|cj/i.test(u)) return
      push({ type: "response", label, status: res.status(), url: u })
    }
    page.on("response", onRes)
    listeners.push(["response", onRes])

    page
      .exposeFunction("__xjtuTracePush", (payload) => {
        if (!payload || typeof payload !== "object") return
        push({ type: "ui", label, ...payload })
      })
      .catch(() => {})

    page
      .addInitScript(() => {
        try {
          if (window.__xjtuTraceInstalled) return
          window.__xjtuTraceInstalled = true
          const send = (payload) => {
            try {
              if (typeof window.__xjtuTracePush === "function") window.__xjtuTracePush(payload)
            } catch (_) {}
          }

          document.addEventListener(
            "click",
            (e) => {
              const t = e.target
              if (!t) return
              const el = t.closest ? t.closest("a,button,input,span,div") : t
              if (!el) return
              const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()
              const id = el.id || ""
              const cls = typeof el.className === "string" ? el.className : ""
              const ampTitle = el.getAttribute ? el.getAttribute("amp-title") : ""
              send({
                event: "click",
                tag: (el.tagName || "").toLowerCase(),
                id,
                cls: cls ? String(cls).slice(0, 120) : "",
                text: text ? text.slice(0, 120) : "",
                ampTitle: ampTitle || "",
                href: el.getAttribute ? el.getAttribute("href") || "" : "",
              })
            },
            true
          )

          document.addEventListener(
            "input",
            (e) => {
              const t = e.target
              if (!t || !t.tagName) return
              const tag = String(t.tagName).toLowerCase()
              if (!["input", "textarea", "select"].includes(tag)) return
              const name = t.getAttribute ? t.getAttribute("name") || "" : ""
              const type = t.getAttribute ? t.getAttribute("type") || "" : ""
              const value = t.value || ""
              send({
                event: "input",
                tag,
                name,
                inputType: type,
                valuePreview: type === "password" ? "<masked>" : String(value).slice(0, 40),
              })
            },
            true
          )

          document.addEventListener(
            "keydown",
            (e) => {
              if (e.key !== "Enter") return
              const t = e.target
              const tag = t && t.tagName ? String(t.tagName).toLowerCase() : ""
              const name = t && t.getAttribute ? t.getAttribute("name") || "" : ""
              send({ event: "keydown", key: e.key, tag, name })
            },
            true
          )
        } catch (_) {}
      })
      .catch(() => {})

    const cleanup = () => {
      for (const [eventName, fn] of listeners) page.off(eventName, fn)
    }
    pageCleanup.set(page, cleanup)

    push({ type: "page-attached", label, url: page.url() })
  }

  function attachContext(context) {
    for (const p of context.pages()) attachPage(p, context.pages().length > 1 ? `page-${context.pages().indexOf(p)}` : "main")
    const onPage = (p) => {
      attachPage(p, "popup")
      push({ type: "new-page", url: p.url() })
    }
    context.on("page", onPage)
    return () => context.off("page", onPage)
  }

  function save(filePath, extra = {}) {
    const out = {
      meta: {
        fetchedAt: nowIso(),
        totalEvents: events.length,
      },
      ...extra,
      events,
    }
    ensureDir(filePath)
    fs.writeFileSync(path.resolve(filePath), JSON.stringify(out, null, 2), "utf-8")
  }

  function stopAll() {
    for (const cleanup of pageCleanup.values()) cleanup()
    pageCleanup.clear()
  }

  return { push, attachPage, attachContext, save, stopAll, getEvents: () => events.slice() }
}

function getAutoBrowserPathCandidates() {
  const list = []
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || ""
    list.push("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    list.push("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe")
    if (localAppData) {
      list.push(path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"))
    }
    list.push("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe")
    list.push("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")
  }
  return list
}

function pushAttempt(attempts, seen, name, options) {
  const key = `${name}|${JSON.stringify(options)}`
  if (seen.has(key)) return
  seen.add(key)
  attempts.push({ name, options })
}

async function launchBrowser() {
  const attempts = []
  const seen = new Set()
  if (BROWSER_PATH) {
    pushAttempt(attempts, seen, `explicit path: ${BROWSER_PATH}`, { executablePath: BROWSER_PATH })
  }
  if (BROWSER_CHANNEL) {
    pushAttempt(attempts, seen, `explicit channel: ${BROWSER_CHANNEL}`, { channel: BROWSER_CHANNEL })
  }
  for (const p of getAutoBrowserPathCandidates()) {
    if (fs.existsSync(p)) pushAttempt(attempts, seen, `auto path: ${p}`, { executablePath: p })
  }
  pushAttempt(attempts, seen, "channel: chrome", { channel: "chrome" })
  pushAttempt(attempts, seen, "channel: msedge", { channel: "msedge" })
  pushAttempt(attempts, seen, "playwright bundled chromium", {})

  const failures = []
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({ headless: HEADLESS, ...attempt.options })
      console.log(`[xjtu-crawler] Browser launched via ${attempt.name}`)
      return browser
    } catch (err) {
      failures.push(`${attempt.name} -> ${err && err.message ? err.message : "unknown error"}`)
    }
  }

  throw new Error(
    [
      "Could not launch any browser.",
      "Try setting XJTU_BROWSER_PATH to your local Chrome/Edge executable.",
      "Launch attempts:",
      ...failures.map((x) => `- ${x}`),
    ].join("\n")
  )
}

function getRoots(page) {
  const roots = [page]
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) roots.push(frame)
  }
  return roots
}

async function clickFirstVisible(root, selectors, timeoutMs = 2000) {
  for (const sel of selectors) {
    const locator = root.locator(sel)
    const count = await locator.count().catch(() => 0)
    for (let i = 0; i < count; i++) {
      const el = locator.nth(i)
      const isVisible = await el.isVisible().catch(() => false)
      const isEnabled = await el.isEnabled().catch(() => false)
      if (!isVisible || !isEnabled) continue
      try {
        await el.click({ timeout: timeoutMs })
        return true
      } catch (_) {
        // try next
      }
    }
  }
  return false
}

async function fillFirstVisible(root, selectors, value, timeoutMs = 1500) {
  for (const sel of selectors) {
    const locator = root.locator(sel)
    const count = await locator.count().catch(() => 0)
    for (let i = 0; i < count; i++) {
      const el = locator.nth(i)
      const isVisible = await el.isVisible().catch(() => false)
      const isEnabled = await el.isEnabled().catch(() => false)
      if (!isVisible || !isEnabled) continue
      try {
        await el.fill(value, { timeout: timeoutMs })
        return true
      } catch (_) {
        // try next
      }
    }
  }
  return false
}

async function clickInRoots(page, selectors, timeoutMs = 2000) {
  const roots = getRoots(page)
  for (const root of roots) {
    if (await clickFirstVisible(root, selectors, timeoutMs)) return true
  }
  return false
}

async function fillInRoots(page, selectors, value, timeoutMs = 1500) {
  const roots = getRoots(page)
  for (const root of roots) {
    if (await fillFirstVisible(root, selectors, value, timeoutMs)) return true
  }
  return false
}

async function collectKeywordTexts(page, keywordList) {
  const roots = getRoots(page)
  const out = []
  for (const root of roots) {
    const textRows = await root
      .$$eval("a,button,span,div,h3,h4,h5", (nodes) =>
        nodes
          .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
          .filter((s) => s && s.length <= 40)
      )
      .catch(() => [])
    for (const t of textRows) {
      if (keywordList.some((k) => t.toLowerCase().includes(String(k).toLowerCase()))) {
        out.push(t)
      }
    }
  }
  return Array.from(new Set(out)).slice(0, 80)
}

function isEhallPortalUrl(rawUrl) {
  try {
    const u = new URL(rawUrl)
    return u.hostname === "ehall.xjtu.edu.cn"
  } catch (_) {
    return false
  }
}

function isPortalShellUrl(rawUrl) {
  return /\/new\/index\.html/i.test(String(rawUrl || ""))
}

function isSelectRoleUrl(rawUrl) {
  return /\/portal\/html\/select_role\.html/i.test(String(rawUrl || ""))
}

async function resolveSelectRolePage(context, expectedUrlPattern = null, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pages = context.pages().slice().reverse()
    for (const p of pages) {
      const u = p.url()
      if (!isSelectRoleUrl(u)) continue

      const roleSelectors = [
        `text=${TXT.studentZh}`,
        `text=${TXT.studentGroupZh}`,
        `a:has-text('${TXT.studentZh}')`,
        `a:has-text('${TXT.studentGroupZh}')`,
        `button:has-text('${TXT.studentZh}')`,
        `button:has-text('${TXT.studentGroupZh}')`,
        "a#20241125142542723",
        "[data-role*='student']",
      ]

      for (let i = 0; i < 8; i++) {
        const clicked = await clickInRoots(p, roleSelectors, 1200).catch(() => false)
        if (clicked) {
          await p.waitForTimeout(700)
          if (expectedUrlPattern) {
            const matched = findPageByUrlPattern(context, expectedUrlPattern)
            if (matched) return matched
          } else if (!isSelectRoleUrl(p.url())) {
            return p
          }
        } else {
          await p.waitForTimeout(300)
        }
      }
    }

    if (expectedUrlPattern) {
      const matched = findPageByUrlPattern(context, expectedUrlPattern)
      if (matched) return matched
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return null
}

async function lookupAppMetaByName(page, names) {
  const list = Array.from(new Set((names || []).filter(Boolean)))
  if (!list.length) return null

  const selectorsByName = (name) => [
    `.appFlag[amp-title='${name}']`,
    `[amp-title='${name}']`,
    `div[amp-title='${name}']`,
    `i[amp-title='${name}']`,
  ]

  async function readFromElement(el) {
    return el
      .evaluate((node) => {
        const holder = node.closest(".appFlag") || node
        const getAttr = (attr) => holder.getAttribute(attr) || node.getAttribute(attr) || ""
        return {
          appTitle: getAttr("amp-title"),
          appId: getAttr("amp-appid"),
          appUrl: getAttr("amp-url"),
          appKey: getAttr("amp-appkey"),
        }
      })
      .catch(() => null)
  }

  for (const name of list) {
    for (const root of getRoots(page)) {
      for (const sel of selectorsByName(name)) {
        const locator = root.locator(sel)
        const count = await locator.count().catch(() => 0)
        for (let i = 0; i < count; i++) {
          const el = locator.nth(i)
          const visible = await el.isVisible().catch(() => false)
          if (!visible) continue
          const meta = await readFromElement(el)
          if (!meta) continue
          if (!meta.appId && !meta.appUrl) continue
          if (!meta.appTitle) meta.appTitle = name
          return meta
        }
      }
    }
  }

  for (const name of list) {
    for (const root of getRoots(page)) {
      for (const sel of selectorsByName(name)) {
        const locator = root.locator(sel)
        const count = await locator.count().catch(() => 0)
        if (!count) continue
        const meta = await readFromElement(locator.first())
        if (!meta) continue
        if (!meta.appId && !meta.appUrl) continue
        if (!meta.appTitle) meta.appTitle = name
        return meta
      }
    }
  }

  return null
}

function buildAppOpenUrl(meta) {
  if (!meta) return ""
  const raw = String(meta.appUrl || "").trim()
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw
    if (raw.startsWith("/")) return `https://ehall.xjtu.edu.cn${raw}`
    return `https://ehall.xjtu.edu.cn/new/${raw.replace(/^\/+/, "")}`
  }
  if (meta.appId) return `https://ehall.xjtu.edu.cn/new/appShow?appId=${meta.appId}`
  return ""
}

function snapshotContextPages(context) {
  const map = new Map()
  for (const p of context.pages()) map.set(p, p.url())
  return map
}

async function clickAppByNames(page, names, options = {}) {
  const list = Array.from(new Set((names || []).filter(Boolean)))
  if (!list.length) return { ok: false, hitName: "", method: "" }

  const strict = options.strict === true
  const rounds = Number(options.rounds || 2)
  const timeoutMs = Number(options.timeoutMs || 2200)

  const escapeQuotes = (s) => String(s || "").replace(/'/g, "\\'")

  for (let r = 0; r < rounds; r++) {
    for (const name of list) {
      const safe = escapeQuotes(name)
      const selectors = [
        `.appFlag[amp-title='${safe}']`,
        `[amp-title='${safe}']`,
        `div[amp-title='${safe}']`,
        `i[amp-title='${safe}']`,
        `.appFlag[title='${safe}']`,
      ]
      const clicked = await clickInRoots(page, selectors, timeoutMs).catch(() => false)
      if (clicked) return { ok: true, hitName: name, method: "attr-selector" }
    }
    await page.waitForTimeout(220).catch(() => {})
  }

  const clickByEval = async () =>
    page
      .evaluate((cand) => {
        try {
          const textNorm = (v) => String(v || "").replace(/\s+/g, "")
          const set = new Set((cand || []).map((x) => textNorm(x)).filter(Boolean))
          const nodes = Array.from(document.querySelectorAll(".appFlag[amp-title], [amp-title], .appFlag, a, button, div, span"))
          const score = (el) => {
            const ampTitle = textNorm(el.getAttribute ? el.getAttribute("amp-title") || "" : "")
            const title = textNorm(el.getAttribute ? el.getAttribute("title") || "" : "")
            const text = textNorm(el.innerText || el.textContent || "")
            for (const name of set) {
              if (!name) continue
              if (ampTitle === name) return { ok: true, name, rank: 4 }
              if (title === name) return { ok: true, name, rank: 3 }
              if (text === name) return { ok: true, name, rank: 2 }
              if (text.includes(name)) return { ok: true, name, rank: 1 }
            }
            return { ok: false, name: "", rank: 0 }
          }

          let best = null
          for (const el of nodes) {
            const m = score(el)
            if (!m.ok) continue
            if (!best || m.rank > best.rank) best = { el, name: m.name, rank: m.rank }
          }
          if (!best || !best.el) return { ok: false, hitName: "", method: "" }
          const target = best.el.closest ? best.el.closest(".appFlag,[amp-title],a,button,div") || best.el : best.el
          if (target && typeof target.click === "function") {
            target.click()
            return { ok: true, hitName: best.name, method: "dom-eval" }
          }
          return { ok: false, hitName: "", method: "" }
        } catch (_) {
          return { ok: false, hitName: "", method: "" }
        }
      }, list)
      .catch(() => ({ ok: false, hitName: "", method: "" }))

  const evalHit = await clickByEval()
  if (evalHit && evalHit.ok) return evalHit

  if (strict) return { ok: false, hitName: "", method: "" }

  for (const name of list) {
    const fuzzy = await clickInRoots(
      page,
      [
        `div:has-text('${name}')`,
        `span:has-text('${name}')`,
        `a:has-text('${name}')`,
        `button:has-text('${name}')`,
        `text=${name}`,
      ],
      timeoutMs
    ).catch(() => false)
    if (fuzzy) return { ok: true, hitName: name, method: "text-fuzzy" }
  }

  return { ok: false, hitName: "", method: "" }
}

async function clickEnterService(page, timeoutMs = 1800, rounds = 10) {
  const selectors = [
    "#ampDetailEnter",
    "a#ampDetailEnter",
    "[id*='DetailEnter']",
    ".amp-detail-enter",
    ".amp-detail-enter.amp-active",
    "a.amp-detail-enter",
    "button.amp-detail-enter",
    `div:has-text('${TXT.enterServiceZh}')`,
    `button:has-text('${TXT.enterServiceZh}')`,
    `a:has-text('${TXT.enterServiceZh}')`,
    "text=进入服务",
  ]

  const clickByEval = async () =>
    page
      .evaluate((enterText) => {
        try {
          const norm = (v) => String(v || "").replace(/\s+/g, "")
          const targetText = norm(enterText)
          const list = Array.from(document.querySelectorAll("a,button,div,span"))
          for (const el of list) {
            const id = String(el.id || "")
            const cls = typeof el.className === "string" ? el.className : ""
            const t = norm(el.innerText || el.textContent || "")
            if (id.includes("DetailEnter") || cls.includes("detail-enter") || t.includes(targetText)) {
              if (typeof el.click === "function") {
                el.click()
                return true
              }
            }
          }
        } catch (_) {}
        return false
      }, TXT.enterServiceZh)
      .catch(() => false)

  for (let i = 0; i < rounds; i++) {
    const clicked = await clickInRoots(page, selectors, timeoutMs).catch(() => false)
    const clickedEval = clicked ? false : await clickByEval()
    if (clicked || clickedEval) {
      await page.waitForTimeout(1200)
      return true
    }
    await page.waitForTimeout(350)
  }
  return false
}

function findPageByUrlPattern(context, expectedUrlPattern) {
  if (!expectedUrlPattern) return null
  const pages = context.pages().slice().reverse()
  for (const p of pages) {
    const u = p.url()
    if (u && expectedUrlPattern.test(u)) return p
  }
  return null
}

async function findNewOrSwitchedAppPage(context, currentPage, beforePageMap, expectedUrlPattern = null) {
  const pages = context.pages()
  const beforePages = Array.from(beforePageMap.keys())
  const freshPages = pages.filter((p) => !beforePages.includes(p)).reverse()
  for (const p of freshPages) {
    await p.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {})
    const u = p.url()
    if (!u || u === "about:blank") continue
    if (expectedUrlPattern && !expectedUrlPattern.test(u) && !isSelectRoleUrl(u)) continue
    return p
  }

  const changedPages = pages.filter((p) => beforePageMap.has(p) && beforePageMap.get(p) !== p.url()).reverse()
  for (const p of changedPages) {
    const u = p.url()
    if (!u || u === "about:blank") continue
    if (expectedUrlPattern && !expectedUrlPattern.test(u) && !isSelectRoleUrl(u)) continue
    if (!isPortalShellUrl(u) || expectedUrlPattern) return p
  }

  if (expectedUrlPattern) {
    const matched = findPageByUrlPattern(context, expectedUrlPattern)
    if (matched) return matched
    const rolePage = context
      .pages()
      .slice()
      .reverse()
      .find((p) => isSelectRoleUrl(p.url()))
    if (rolePage) return rolePage
    return null
  }

  const all = pages.slice().reverse()
  for (const p of all) {
    const u = p.url()
    if (!u || u === "about:blank") continue
    if (!isPortalShellUrl(u)) return p
  }

  if (!isPortalShellUrl(currentPage.url())) return currentPage
  return null
}

async function tryDirectOpenUrls(context, page, urls, expectedUrlPattern = null) {
  const list = Array.from(new Set((urls || []).filter(Boolean)))
  for (const u of list) {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: WAIT_MS })
      // networkidle can be unstable on jwapp pages; treat it as best-effort.
      await page.waitForLoadState("networkidle", { timeout: Math.min(WAIT_MS, 8000) }).catch(() => {})
      if (expectedUrlPattern) {
        const matched = findPageByUrlPattern(context, expectedUrlPattern)
        if (matched) return { ok: true, targetPage: matched, hitUrl: u }
      } else if (!isPortalShellUrl(page.url())) {
        return { ok: true, targetPage: page, hitUrl: u }
      }
    } catch (_) {
      // try next url
    }
  }
  return { ok: false, targetPage: null, hitUrl: "" }
}

async function ensureStudentRole(page) {
  const roleSwitchSelectors = [
    "[bh-header-role='roleSwitch']",
    ".bh-headerBar-roleSwitch",
    "text=学生组",
    "text=学生",
  ]
  const roleOptionSelectors = [
    ".bh-headerBar-roleBox-title a:has-text('学生')",
    ".bh-headerBar-roleBox-title a#20241125142542723",
    ".bh-headerBar-roleBox-title a:has-text('学生组')",
  ]

  // Try opening role switch and selecting "学生" role if presented.
  for (let i = 0; i < 3; i++) {
    await clickInRoots(page, roleSwitchSelectors, 1200).catch(() => {})
    await page.waitForTimeout(350)

    const selected = await clickInRoots(page, roleOptionSelectors, 1200).catch(() => false)
    if (selected) {
      await page.waitForTimeout(1000)
      return true
    }
  }
  return false
}

async function openTargetAppByPortal(context, appId, expectedUrlPattern, timeoutMs = 15000) {
  const enterSelectors = [
    "#ampDetailEnter",
    "a#ampDetailEnter",
    ".amp-detail-enter.amp-active",
    "a.amp-detail-enter.amp-active",
    "div:has-text('进入服务')",
    "button:has-text('进入服务')",
    "a:has-text('进入服务')",
  ]

  const waitExpected = async (watchPage, ms) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      const roleResolved = await resolveSelectRolePage(context, expectedUrlPattern, 1000).catch(() => null)
      if (roleResolved) return roleResolved

      const matched = findPageByUrlPattern(context, expectedUrlPattern)
      if (matched) return matched

      if (watchPage) await watchPage.waitForTimeout(250).catch(() => {})
      else await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return null
  }

  const openOne = async (p) => {
    if (!/\/new\/index\.html/i.test(p.url())) {
      await p.goto(ENTRY_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch(() => {})
      await p.waitForTimeout(800)
    }

    await p.evaluate((id) => {
      try {
        const all = Array.from(document.querySelectorAll(".appFlag[amp-appid], [amp-appid]"))
        const node = all.find((el) => String(el.getAttribute("amp-appid")) === String(id))
        if (node && typeof node.click === "function") node.click()
      } catch (_) {}
    }, String(appId))

    await clickInRoots(p, enterSelectors, 1500).catch(() => {})
  }

  const portalPages = context
    .pages()
    .filter((p) => /ehall\.xjtu\.edu\.cn\/new\//i.test(p.url()))
    .slice()
    .reverse()

  for (const portal of portalPages) {
    await openOne(portal).catch(() => {})
    const matched = await waitExpected(portal, timeoutMs)
    if (matched) return matched
  }
  return null
}

async function tryDirectOpenByMeta(page, appMeta) {
  const target = buildAppOpenUrl(appMeta)
  if (!target) return false
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: WAIT_MS })
    // networkidle can time out due long-polling; do not treat as failure.
    await page.waitForLoadState("networkidle", { timeout: Math.min(WAIT_MS, 10000) }).catch(() => {})
    return true
  } catch (_) {
    return false
  }
}

async function waitForEhallPortal(page, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (isEhallPortalUrl(page.url())) return true
    await page.waitForTimeout(300)
  }
  return false
}

async function hasVisibleAny(page, selectors, perSelectorMax = 3) {
  for (const sel of selectors || []) {
    const locator = page.locator(sel)
    const count = await locator.count().catch(() => 0)
    const maxN = Math.min(count, perSelectorMax)
    for (let i = 0; i < maxN; i++) {
      const visible = await locator.nth(i).isVisible().catch(() => false)
      if (visible) return true
    }
  }
  return false
}

function isCasLoginUrl(rawUrl) {
  const u = String(rawUrl || "")
  return /login\.xjtu\.edu\.cn/i.test(u) || /\/cas\//i.test(u)
}

async function isLoggedInEhall(page) {
  const url = page.url()
  if (!isEhallPortalUrl(url)) return false

  // If we're already in role-selection/app pages, it means auth already passed.
  if (isSelectRoleUrl(url) || /\/jwapp\//i.test(url) || /\/new\/appShow/i.test(url)) return true

  // If portal still shows Login button, it is definitely not logged in.
  const loginHintSelectors = [
    "a[href*='login.xjtu.edu.cn']",
    "button:has-text('Login')",
    "a:has-text('Login')",
    "text=Login",
    "button:has-text('登录')",
    "a:has-text('登录')",
    "text=登录",
    "text=统一身份认证",
  ]
  const hasVisibleLoginHint = await hasVisibleAny(page, loginHintSelectors, 2)
  if (hasVisibleLoginHint) return false

  const markers = [
    "#ampHeaderToolUserName",
    "[bh-header-role='roleSwitch']",
    ".bh-headerBar-roleSwitch",
    "#ampPageHeaderSearchIcon",
    ".amp-pageheader-search-icon",
    "#ampServiceSearchInput",
    ".appFlag[amp-appid]",
  ]
  const hasVisibleMarkers = await hasVisibleAny(page, markers, 4)
  if (hasVisibleMarkers) return true

  return false
}

async function openLoginIfNeeded(page) {
  const loginSelectors = [
    "a[href*='login.xjtu.edu.cn']",
    "button:has-text('Login')",
    "a:has-text('Login')",
    "text=Login",
    "button:has-text('登录')",
    "a:has-text('登录')",
    "text=登录",
    "text=统一身份认证",
  ]

  // Try normal click route first.
  let clicked = await clickInRoots(
    page,
    loginSelectors,
    2200
  ).catch(() => false)
  if (!clicked) {
    // Fallback: trigger login element by evaluate (some portal skins block normal click).
    clicked = await page
      .evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false
          const style = window.getComputedStyle(el)
          if (!style) return false
          if (style.display === "none" || style.visibility === "hidden") return false
          return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        }
        const norm = (v) => String(v || "").replace(/\s+/g, "").toLowerCase()
        const nodes = Array.from(document.querySelectorAll("a,button,div,span"))
        for (const el of nodes) {
          if (!isVisible(el)) continue
          const href = String(el.getAttribute && el.getAttribute("href") ? el.getAttribute("href") : "")
          const txt = norm(el.innerText || el.textContent || "")
          if (
            href.includes("login.xjtu.edu.cn") ||
            txt === "login" ||
            txt.includes("login") ||
            txt.includes("登录") ||
            txt.includes("统一身份认证")
          ) {
            if (typeof el.click === "function") {
              el.click()
              return true
            }
          }
        }
        return false
      })
      .catch(() => false)
  }

  if (!clicked) return false

  // Wait for navigation to CAS/login page.
  const startedAt = Date.now()
  while (Date.now() - startedAt < WAIT_MS) {
    const u = page.url()
    if (/login\.xjtu\.edu\.cn/i.test(u) || /\/cas\//i.test(u)) return true
    if (!isPortalShellUrl(u) && !/ehall\.xjtu\.edu\.cn\/new\/index\.html/i.test(u)) return true
    await page.waitForTimeout(250)
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {})
  return true
}

async function ensureCasLoginPage(page, timeoutMs = WAIT_MS, context = null) {
  // Already on CAS/login page.
  if (isCasLoginUrl(page.url())) return page

  const opened = await openLoginIfNeeded(page).catch(() => false)
  if (!opened) return null

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (isCasLoginUrl(page.url())) return page

    if (context) {
      const pages = context.pages().slice().reverse()
      const casPage = pages.find((p) => isCasLoginUrl(p.url()))
      if (casPage) return casPage
    }

    await page.waitForTimeout(250)
  }
  return null
}

async function waitForLoggedIn(page, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedInEhall(page)) return true
    await page.waitForTimeout(350)
  }
  return false
}

async function waitForAnyLoggedIn(context, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pages = context.pages().slice().reverse()
    for (const p of pages) {
      if (await isLoggedInEhall(p)) return p
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return null
}

async function loginToEhall(page) {
  const context = page.context()
  let workingPage = page

  await page.goto(ENTRY_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS })
  console.log(`[xjtu-crawler] Auto login start. url=${page.url()}`)

  if (MANUAL_LOGIN) {
    console.log("[xjtu-crawler] Manual login mode.")
    console.log(`[xjtu-crawler] Current url: ${page.url()}`)
    console.log("[xjtu-crawler] Please finish login in the opened browser first.")
    if (process.stdin.isTTY) {
      await waitForEnter(
        "[xjtu-crawler] After login reaches ehall home (e.g. /new/index.html?browser=no), press Enter to continue..."
      )
    } else {
      console.log("[xjtu-crawler] Non-interactive terminal detected, waiting for redirect...")
    }
    const okPage = await waitForAnyLoggedIn(context, WAIT_MS * 60)
    if (!okPage) throw new Error("Manual login timeout. Did not reach logged-in ehall state in time.")
    return okPage
  }

  if (await isLoggedInEhall(page)) return page

  if (!USERNAME || !PASSWORD) {
    throw new Error("Missing credentials. Set XJTU_EHALL_USER/XJTU_EHALL_PASS or use XJTU_MANUAL_LOGIN=true.")
  }

  // Force the expected flow:
  // ehall home -> click Login -> CAS page -> fill account/password -> back to logged-in ehall.
  const casPage = await ensureCasLoginPage(workingPage, WAIT_MS, context)
  if (!casPage) {
    throw new Error("Could not reach CAS login page from ehall home.")
  }
  workingPage = casPage
  console.log(`[xjtu-crawler] CAS login page ready. url=${workingPage.url()}`)

  // Ensure we are on login form page before filling credentials.
  const casReady = isCasLoginUrl(workingPage.url())
  if (!casReady) {
    throw new Error(`Unexpected page before credential fill: ${workingPage.url()}`)
  }

  const userSelectors = [
    "input[name='username']",
    "input[name='userName']",
    "input#username",
    `input[placeholder*='${TXT.studentIdZh}']`,
    `input[placeholder*='${TXT.accountZh}']`,
    "input[type='text']",
  ]
  const passSelectors = [
    "input[type='password']",
    "input[name='password']:not([type='hidden'])",
    "input#password:not([type='hidden'])",
    `input[placeholder*='${TXT.passwordZh}']`,
  ]
  const buttonSelectors = [
    "button[type='submit']",
    "button[name='submit']",
    `button:has-text('${TXT.loginZh}')`,
    "button:has-text('Login')",
    "input[type='submit']",
    ".login-btn",
    "#login_submit",
  ]

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await isLoggedInEhall(workingPage)) return workingPage

    // If redirected back to ehall but still not logged in, reopen CAS and retry.
    if (isPortalShellUrl(workingPage.url()) && !(await isLoggedInEhall(workingPage))) {
      const casOpen = await ensureCasLoginPage(workingPage, 6000, context).catch(() => null)
      if (!casOpen) {
        await page.waitForTimeout(500)
        continue
      }
      workingPage = casOpen
    }

    console.log(`[xjtu-crawler] Auto login attempt ${attempt + 1}. url=${workingPage.url()}`)

    const u = await fillInRoots(workingPage, userSelectors, USERNAME)
    const p = await fillInRoots(workingPage, passSelectors, PASSWORD)
    if (!u || !p) {
      await workingPage.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {})
      await workingPage.waitForTimeout(500)
      continue
    }
    const clicked = await clickInRoots(workingPage, buttonSelectors, 3000)
    if (!clicked) throw new Error("Could not find login button automatically.")
    await workingPage.waitForLoadState("networkidle", { timeout: WAIT_MS }).catch(() => {})

    const loggedInPage = await waitForAnyLoggedIn(context, 20000)
    if (loggedInPage) return loggedInPage
  }

  throw new Error(`Could not complete auto login. finalUrl=${workingPage.url()}`)
}

async function openServiceCard(page, appName, strictOnly = false) {
  // 1) Try common menu entrances first.
  await clickInRoots(page, [
    ".amp-pageheader-search-icon",
    "#ampPageHeaderSearchIcon",
    ".icon-search",
    ".fa-search",
    `a:has-text('${TXT.allServiceZh}')`,
    `div:has-text('${TXT.allServiceZh}')`,
    `span:has-text('${TXT.allServiceZh}')`,
    `a:has-text('${TXT.appCenterZh}')`,
    `div:has-text('${TXT.appCenterZh}')`,
    `span:has-text('${TXT.appCenterZh}')`,
    `a:has-text('${TXT.serviceHallZh}')`,
    `div:has-text('${TXT.serviceHallZh}')`,
    `span:has-text('${TXT.serviceHallZh}')`,
    `a:has-text('${TXT.moreZh}')`,
    `div:has-text('${TXT.moreZh}')`,
    `span:has-text('${TXT.moreZh}')`,
  ]).catch(() => {})
  await page.waitForTimeout(350)

  // 2) Prefer exact app card without typing search text (avoid auto-suggest wrong app).
  const exactFirst = await clickAppByNames(page, [appName], { strict: true, rounds: 2, timeoutMs: 2500 }).catch(() => ({
    ok: false,
    hitName: "",
    method: "",
  }))
  if (exactFirst.ok) return true

  // 3) If still not found, use search input then click exact app attribute.
  await fillInRoots(
    page,
    [
      "#ampServiceSearchInput",
      `input[placeholder*='${TXT.searchZh}']`,
      `input[placeholder*='${TXT.serviceZh}']`,
      `input[placeholder*='${TXT.appZh}']`,
      "input[type='search']",
    ],
    appName,
    1500
  ).catch(() => {})
  await page.waitForTimeout(500)

  const exactAfterSearch = await clickAppByNames(page, [appName], { strict: true, rounds: 2, timeoutMs: 2500 }).catch(() => ({
    ok: false,
    hitName: "",
    method: "",
  }))
  if (exactAfterSearch.ok) return true

  if (strictOnly) return false

  // 4) Fallback by visible text.
  const textClicked = await clickAppByNames(page, [appName], { strict: false, rounds: 1, timeoutMs: 2500 }).catch(() => ({
    ok: false,
    hitName: "",
    method: "",
  }))
  return textClicked.ok
}

async function enterServiceFromDetail(page) {
  return clickEnterService(page, 2000, 5) // unified enter-service click path
  // After clicking a card, portal usually opens detail dialog, must click "进入服务".
  const selectors = [
    "#ampDetailEnter",
    ".amp-detail-enter.amp-active",
    "a#ampDetailEnter",
    "a.amp-detail-enter.amp-active",
    `div:has-text('${TXT.enterServiceZh}')`,
    `button:has-text('${TXT.enterServiceZh}')`,
    "a:has-text('进入服务')",
  ]

  // Try several short rounds because dialog animates.
  for (let i = 0; i < 5; i++) {
    const clicked = await clickInRoots(page, selectors, 2000)
    if (clicked) {
      await page.waitForTimeout(1000)
      return true
    }
    await page.waitForTimeout(400)
  }
  return false
}

async function enterServiceFromDetailStrict(page) {
  return clickEnterService(page, 1800, 10) // strict path delegates to same enter-service clicker
  const selectors = [
    "#ampDetailEnter",
    "a#ampDetailEnter",
    "[id*='DetailEnter']",
    ".amp-detail-enter",
    ".amp-detail-enter.amp-active",
    "a.amp-detail-enter",
    "button.amp-detail-enter",
    `div:has-text('${TXT.enterServiceZh}')`,
    `button:has-text('${TXT.enterServiceZh}')`,
    `a:has-text('${TXT.enterServiceZh}')`,
    "text=进入服务",
  ]

  const clickByEval = async () =>
    page
      .evaluate((enterText) => {
        try {
          const list = Array.from(document.querySelectorAll("a,button,div,span"))
          for (const el of list) {
            const id = el.id || ""
            const cls = typeof el.className === "string" ? el.className : ""
            const t = (el.innerText || el.textContent || "").replace(/\s+/g, "").trim()
            if (id.includes("DetailEnter") || cls.includes("detail-enter") || t.includes(enterText)) {
              if (typeof el.click === "function") {
                el.click()
                return true
              }
            }
          }
        } catch (_) {}
        return false
      }, TXT.enterServiceZh)
      .catch(() => false)

  for (let i = 0; i < 10; i++) {
    const clicked = await clickInRoots(page, selectors, 1800).catch(() => false)
    const clickedEval = clicked ? false : await clickByEval()
    if (clicked || clickedEval) {
      await page.waitForTimeout(1200)
      return true
    }
    await page.waitForTimeout(350)
  }
  return false
}

async function backToPortalHome(context, fallbackPage = null) {
  const allPages = context.pages().slice().reverse()
  for (const p of allPages) {
    if (/\/new\/index\.html/i.test(p.url())) return p
  }

  const p = fallbackPage || context.pages()[0]
  if (!p) return null
  await p.goto(ENTRY_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch(() => {})
  await waitForEhallPortal(p, WAIT_MS).catch(() => {})
  if (/\/new\/index\.html/i.test(p.url())) return p
  return p
}

async function closeCoursePagesAndReturnHome(context, fallbackPage = null, waitBeforeCloseMs = 3000) {
  const pages = context.pages().slice()
  for (const p of pages) {
    const u = p.url()
    if (!/\/jwapp\/sys\/wdkb\//i.test(u)) continue
    if (typeof p.isClosed === "function" && p.isClosed()) continue
    console.log(`[xjtu-crawler] Course page stable wait ${waitBeforeCloseMs}ms before close: ${u}`)
    if (waitBeforeCloseMs > 0) await p.waitForTimeout(waitBeforeCloseMs).catch(() => {})
    await p.close().catch(() => {})
  }
  const home = await backToPortalHome(context, fallbackPage).catch(() => null)
  return home
}

async function findAndOpenApp(
  context,
  page,
  appName,
  fallbackName = "",
  expectedUrlPattern = null,
  directUrls = [],
  options = {}
) {
  const strictPrimary = options && options.strictPrimary === true
  const strictFallback = options && options.strictFallback === true
  const preferredNames = Array.from(new Set([appName, fallbackName].filter(Boolean)))
  const debug = {
    appName,
    fallbackName,
    clickedCard: false,
    clickedEnter: false,
    directOpened: false,
    urlBefore: page.url(),
    urlAfter: "",
    appMeta: null,
    switchedToNewPage: false,
    targetPageUrl: "",
    directHitUrl: "",
    visibleMatches: [],
    clickedAppName: "",
    clickedAppMethod: "",
  }
  const names = [appName, fallbackName].filter(Boolean)
  const beforePageMap = snapshotContextPages(context)

  // If target app page is already open, reuse it first.
  const existed = findPageByUrlPattern(context, expectedUrlPattern)
  if (existed) {
    debug.targetPageUrl = existed.url()
    debug.urlAfter = page.url()
    return { opened: true, targetPage: existed, debug }
  }

  // Try primary/fallback by one unified click flow to keep course/score symmetric.
  let clickResult = await clickAppByNames(page, preferredNames, {
    strict: strictPrimary && !fallbackName,
    rounds: 2,
    timeoutMs: 2500,
  }).catch(() => ({ ok: false, hitName: "", method: "" }))
  let opened = clickResult.ok
  if (!opened && preferredNames.length) {
    for (const name of preferredNames) {
      const one = await openServiceCard(page, name, strictPrimary && !fallbackName).catch(() => false)
      if (!one) continue
      clickResult = { ok: true, hitName: name, method: "openServiceCard" }
      opened = true
      break
    }
  }
  if (!opened) {
    if (strictPrimary && !fallbackName) {
      console.log(`[xjtu-crawler] Strict app match failed for "${appName}". Skip fuzzy match to avoid wrong app.`)
    }
    debug.visibleMatches = await collectKeywordTexts(page, [appName, fallbackName].filter(Boolean))
    debug.urlAfter = page.url()
    return { opened: false, targetPage: page, debug }
  }
  debug.clickedCard = true
  debug.clickedAppName = clickResult.hitName || ""
  debug.clickedAppMethod = clickResult.method || ""

  const appMeta = await lookupAppMetaByName(page, names)
  debug.appMeta = appMeta

  // Role page is part of normal flow: click "学生/学生组" and wait for auto redirect.
  const roleResolvedEarly = await resolveSelectRolePage(context, expectedUrlPattern, 3500).catch(() => null)
  if (roleResolvedEarly) {
    console.log(`[xjtu-crawler] Role page resolved by auto-select: ${roleResolvedEarly.url()}`)
    debug.switchedToNewPage = roleResolvedEarly !== page
    debug.targetPageUrl = roleResolvedEarly.url()
    debug.urlAfter = page.url()
    return { opened: true, targetPage: roleResolvedEarly, debug }
  }

  // Some cards can directly open app page.
  let targetPage = await findNewOrSwitchedAppPage(context, page, beforePageMap, expectedUrlPattern)
  if (targetPage && isSelectRoleUrl(targetPage.url())) {
    const resolved = await resolveSelectRolePage(context, expectedUrlPattern, WAIT_MS).catch(() => null)
    if (resolved) targetPage = resolved
  }
  if (targetPage) {
    debug.switchedToNewPage = targetPage !== page
    debug.targetPageUrl = targetPage.url()
    debug.urlAfter = page.url()
    return { opened: true, targetPage, debug }
  }

  // Detail dialog -> enter service.
  const enterOk = await enterServiceFromDetailStrict(page)
  debug.clickedEnter = enterOk
  if (debug.clickedCard && !enterOk) {
    console.log("[xjtu-crawler] Enter-service click still not confirmed after strict attempts.")
  }
  await page.waitForTimeout(1200)

  targetPage = await findNewOrSwitchedAppPage(context, page, beforePageMap, expectedUrlPattern)
  if (targetPage && isSelectRoleUrl(targetPage.url())) {
    const resolved = await resolveSelectRolePage(context, expectedUrlPattern, WAIT_MS).catch(() => null)
    if (resolved) targetPage = resolved
  }
  if (!targetPage) {
    // Prefer normal portal -> select_role -> auto redirect flow first.
    const roleResolvedMid = await resolveSelectRolePage(context, expectedUrlPattern, 4500).catch(() => null)
    if (roleResolvedMid) {
      console.log(`[xjtu-crawler] Role page resolved after enter-service: ${roleResolvedMid.url()}`)
      targetPage = roleResolvedMid
    } else {
      const directOk = await tryDirectOpenByMeta(page, appMeta)
      debug.directOpened = directOk
      if (directOk) {
        if (expectedUrlPattern) {
          const matched = findPageByUrlPattern(context, expectedUrlPattern)
          if (matched) targetPage = matched
        } else if (!isPortalShellUrl(page.url())) {
          targetPage = page
        }
      }
    }
  }

  if (!targetPage) {
    const allDirectUrls = []
    allDirectUrls.push(...directUrls)
    const metaUrl = buildAppOpenUrl(appMeta)
    if (metaUrl) allDirectUrls.push(metaUrl)
    const directHit = await tryDirectOpenUrls(context, page, allDirectUrls, expectedUrlPattern)
    if (directHit.ok) {
      debug.directOpened = true
      debug.directHitUrl = directHit.hitUrl
      targetPage = directHit.targetPage || page
      if (targetPage && isSelectRoleUrl(targetPage.url())) {
        const resolved = await resolveSelectRolePage(context, expectedUrlPattern, WAIT_MS).catch(() => null)
        if (resolved) targetPage = resolved
      }
    }
  }

  await page.waitForLoadState("domcontentloaded", { timeout: WAIT_MS }).catch(() => {})
  await page.waitForTimeout(1000)

  if (!targetPage) {
    debug.urlAfter = page.url()
    return { opened: false, targetPage: page, debug }
  }

  debug.switchedToNewPage = targetPage !== page
  debug.targetPageUrl = targetPage.url()
  debug.urlAfter = page.url()
  return { opened: true, targetPage, debug }
}

async function captureNetworkJson(context, keywordList) {
  const records = []
  const handler = async (response) => {
    const url = response.url()
    if (!keywordList.some((k) => url.toLowerCase().includes(String(k).toLowerCase()))) return
    try {
      const ct = response.headers()["content-type"] || ""
      if (!ct.includes("json")) return
      const data = await response.json()
      records.push({ url, status: response.status(), data })
    } catch (_) {
      // ignore
    }
  }

  const attachedPages = new Set()
  const attachPage = (p) => {
    if (attachedPages.has(p)) return
    attachedPages.add(p)
    p.on("response", handler)
  }

  for (const p of context.pages()) attachPage(p)
  const onPage = (p) => attachPage(p)
  context.on("page", onPage)

  return {
    stop: () => {
      context.off("page", onPage)
      for (const p of attachedPages) p.off("response", handler)
    },
    get: () => records,
  }
}

async function collectTablesInAllFrames(page) {
  const tables = []
  const roots = getRoots(page)
  const tableCandidates = ["table", ".el-table", ".ivu-table", ".ant-table"]
  for (const root of roots) {
    for (const selector of tableCandidates) {
      const count = await root.locator(selector).count().catch(() => 0)
      if (!count) continue
      const rows = await root
        .$$eval(`${selector} tr`, (trs) =>
          trs.map((tr) =>
            Array.from(tr.querySelectorAll("th,td")).map((x) =>
              (x.textContent || "").replace(/\s+/g, " ").trim()
            )
          )
        )
        .catch(() => [])
      if (rows.length) {
        tables.push({ selector, rows })
      }
    }
  }
  return tables
}

async function prepareScoreQueryPage(page) {
  // Score page needs switching tab to "全部" (not the filter radio "全部").
  const allTabSelectors = [
    ".jqx-tabs-title:has-text('全部')",
    "li[role='tab']:has-text('全部')",
    ".jqx-tabs-titleContentWrapper:has-text('全部')",
    ".cjcx-tab li:has-text('全部')",
  ]
  const allFallbackSelectors = [
    // fallback when tab selectors fail
    ".bh-label-radio[data-id='ALL']",
    `span:has-text('${TXT.allZh}')`,
    `div:has-text('${TXT.allZh}')`,
  ]
  const querySelectors = [
    "a[bh-advanced-query-role='easySearchBtn']",
    "a[bh-advanced-query-role='advancedSearchBtn']",
    `text=${TXT.queryZh}`,
    `button:has-text('${TXT.queryZh}')`,
    `span:has-text('${TXT.queryZh}')`,
    "a:has-text('搜索')",
    ".el-button:has-text('查询')",
    ".ivu-btn:has-text('查询')",
    ".ant-btn:has-text('查询')",
  ]

  let clickedAllTab = false
  let clickedAllFallback = false
  let clickedQuery = false

  for (let i = 0; i < 5; i++) {
    const hitAllTab = await clickInRoots(page, allTabSelectors, 1200).catch(() => false)
    if (hitAllTab) {
      clickedAllTab = true
      await page.waitForTimeout(400)
      break
    }
    await page.waitForTimeout(250)
  }

  if (!clickedAllTab) {
    for (let i = 0; i < 3; i++) {
      const hitAllFallback = await clickInRoots(page, allFallbackSelectors, 1200).catch(() => false)
      if (hitAllFallback) {
        clickedAllFallback = true
        await page.waitForTimeout(300)
        break
      }
      await page.waitForTimeout(200)
    }
  }

  for (let i = 0; i < 4; i++) {
    const hitQuery = await clickInRoots(page, querySelectors, 1200).catch(() => false)
    if (hitQuery) {
      clickedQuery = true
      await page.waitForTimeout(1000)
      break
    }
    await page.waitForTimeout(250)
  }

  // Wait a bit for async table refresh / API requests to settle.
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1200)

  return {
    clickedAllTab,
    clickedAllFallback,
    clickedQuery,
  }
}

function hasScoreApiData(apiList) {
  const hit = (apiList || []).find((a) => (a.url || "").includes("xscjcx.do"))
  if (!hit || !hit.data || typeof hit.data !== "object") return false
  const datas = hit.data.datas
  if (!datas || typeof datas !== "object") return false
  return Object.keys(datas).length > 0
}

function toPositiveInt(v, fallback = 0) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function parseScorePageRecord(apiRecord) {
  if (!apiRecord || typeof apiRecord !== "object") return null
  const url = String(apiRecord.url || "")
  if (!url.includes("xscjcx.do")) return null
  const data = apiRecord.data
  if (!data || typeof data !== "object") return null
  const datas = data.datas
  if (!datas || typeof datas !== "object") return null
  const raw = datas.xscjcx && typeof datas.xscjcx === "object" ? datas.xscjcx : null
  if (!raw || !Array.isArray(raw.rows)) return null

  const pageNumber = toPositiveInt(raw.pageNumber || raw.currentPage || raw.pageNo || 1, 1)
  const pageSize = toPositiveInt(raw.pageSize || raw.limit || raw.rows.length || 0, raw.rows.length || 0)
  const totalSize = toPositiveInt(raw.totalSize || raw.total || 0, 0)

  return {
    pageNumber,
    pageSize,
    totalSize,
    rows: raw.rows,
    url,
  }
}

function extractScorePagesFromApi(apiList) {
  const latestByPage = new Map()
  for (const rec of apiList || []) {
    const page = parseScorePageRecord(rec)
    if (!page) continue
    latestByPage.set(page.pageNumber, page)
  }
  return Array.from(latestByPage.values()).sort((a, b) => a.pageNumber - b.pageNumber)
}

function mergeScoreRows(scorePages) {
  const out = []
  const seen = new Set()
  for (const p of scorePages || []) {
    const rows = Array.isArray(p.rows) ? p.rows : []
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        out.push(row)
        continue
      }
      const key =
        String(row.WID || "").trim() ||
        [row.XNXQDM || "", row.KCH || "", row.JXBID || "", row.KXH || "", row.CJYQ || ""].join("|")
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}

function buildScorePageSummary(scorePages, pagerSummary = null) {
  const pages = Array.isArray(scorePages) ? scorePages : []
  const capturedPages = pages
    .map((p) => toPositiveInt(p.pageNumber, 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b)

  let totalSize = 0
  for (const p of pages) {
    totalSize = Math.max(totalSize, toPositiveInt(p.totalSize, 0))
  }
  if (!totalSize && pagerSummary) totalSize = toPositiveInt(pagerSummary.totalSize, 0)

  let pageSize = 0
  for (const p of pages) {
    const n = toPositiveInt(p.pageSize, 0)
    if (n > 0) {
      pageSize = n
      break
    }
  }
  if (!pageSize && pagerSummary) pageSize = toPositiveInt(pagerSummary.pageSize, 0)

  let totalPages = pagerSummary ? toPositiveInt(pagerSummary.totalPages, 0) : 0
  if (!totalPages && totalSize > 0 && pageSize > 0) {
    totalPages = Math.ceil(totalSize / pageSize)
  }
  if (!totalPages && capturedPages.length) {
    totalPages = Math.max(...capturedPages)
  }

  return {
    totalPages,
    totalSize,
    pageSize,
    capturedPages,
    capturedPageCount: capturedPages.length,
  }
}

async function readScorePagerSummary(page) {
  return page
    .evaluate(() => {
      const norm = (v) => String(v || "").replace(/\s+/g, " ").trim()
      const numEl =
        document.querySelector("#pagerqb-index-table .bh-pager-num") ||
        document.querySelector("#pagerdqxq-index-table .bh-pager-num") ||
        document.querySelector(".bh-pager .bh-pager-num")
      const noEl =
        document.querySelector("#pagerqb-index-table .bh-pager-no") ||
        document.querySelector("#pagerdqxq-index-table .bh-pager-no") ||
        document.querySelector(".bh-pager .bh-pager-no")
      const numText = norm(numEl ? numEl.textContent : "")
      const noText = norm(noEl ? noEl.textContent : "")

      let totalSize = 0
      let totalPages = 0
      let pageSize = 0
      const numValues = (numText.match(/\d+/g) || []).map((x) => Number(x) || 0).filter((n) => n > 0)
      if (numValues.length) totalSize = numValues[numValues.length - 1]
      const noValues = (noText.match(/\d+/g) || []).map((x) => Number(x) || 0).filter((n) => n > 0)
      if (noValues.length) totalPages = noValues[noValues.length - 1]

      const totalSizeMatch = numText.match(/总记录数\s*(\d+)/)
      if (totalSizeMatch) totalSize = Number(totalSizeMatch[1]) || 0

      const totalPageMatch = noText.match(/总页数\s*(\d+)/)
      if (totalPageMatch) totalPages = Number(totalPageMatch[1]) || 0

      const rangeMatch = numText.match(/(\d+)\s*-\s*(\d+)\s*总记录数\s*(\d+)/)
      if (rangeMatch) {
        const left = Number(rangeMatch[1]) || 0
        const right = Number(rangeMatch[2]) || 0
        if (right >= left && left > 0) pageSize = right - left + 1
      }

      return { totalSize, totalPages, pageSize, numText, noText }
    })
    .catch(() => ({
      totalSize: 0,
      totalPages: 0,
      pageSize: 0,
      numText: "",
      noText: "",
    }))
}

async function clickScorePagerNext(page) {
  const clickedByEval = await page
    .evaluate(() => {
      const roots = [
        document.querySelector("#pagerqb-index-table"),
        document.querySelector("#pagerdqxq-index-table"),
        document.querySelector(".bh-pager"),
        document,
      ].filter(Boolean)

      const isVisible = (el) => {
        if (!el) return false
        const style = window.getComputedStyle(el)
        if (!style) return false
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) return false
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      }

      const isDisabled = (el) => {
        const cls = String(el.className || "").toLowerCase()
        if (el.hasAttribute("disabled")) return true
        return cls.includes("disabled") || cls.includes("disable") || cls.includes("bh-disabled")
      }

      for (const root of roots) {
        const btns = Array.from(root.querySelectorAll("[pager-flag='next']"))
        for (const btn of btns) {
          if (!isVisible(btn) || isDisabled(btn)) continue
          if (typeof btn.click === "function") {
            btn.click()
            return true
          }
        }
      }
      return false
    })
    .catch(() => false)
  if (clickedByEval) return true

  return clickInRoots(
    page,
    [
      "#pagerqb-index-table [pager-flag='next']",
      "#pagerdqxq-index-table [pager-flag='next']",
      ".bh-pager [pager-flag='next']",
      "[pager-flag='next']",
    ],
    1500
  ).catch(() => false)
}

async function waitForScorePageCaptured(page, monitor, expectedPageNumber, timeoutMs = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const apiNow = monitor.get()
    const pagesNow = extractScorePagesFromApi(apiNow)
    const found = pagesNow.find((p) => p.pageNumber === expectedPageNumber)
    if (found) return { ok: true, page: found, pages: pagesNow }
    await page.waitForTimeout(250)
  }
  return { ok: false, page: null, pages: extractScorePagesFromApi(monitor.get()) }
}

async function safeTitle(page) {
  const roots = getRoots(page)
  for (const root of roots) {
    for (const sel of ["h1", "h2", ".title", ".app-title", "header", "#ampHeaderToolUserName"]) {
      const el = root.locator(sel).first()
      const n = await el.count().catch(() => 0)
      if (!n) continue
      const t = await el.textContent().catch(() => "")
      if (t && t.trim()) return t.trim()
    }
  }
  return ""
}

async function collectCourseData(context, page) {
  const monitor = await captureNetworkJson(context, [
    "course",
    "kcb",
    "kb",
    "schedule",
    "wdkb",
    "xskcb",
    "xswpkc",
    "xsdkkc",
    TXT.courseTableZh,
  ])
  if (DEBUG_MODE) await dumpDebugPage(page, "stage-course-before")
  await ensureStudentRole(page).catch(() => {})

  const openResult = await findAndOpenApp(
    context,
    page,
    TXT.myCourseTableZh,
    TXT.courseTableZh,
    /\/jwapp\/sys\/wdkb\//i,
    [],
    { strictPrimary: true, strictFallback: false }
  )
  if (!openResult.opened) {
    const forced = await openTargetAppByPortal(context, "4770397878132218", /\/jwapp\/sys\/wdkb\//i).catch(() => null)
    if (forced) {
      const targetPage = forced
      await targetPage.waitForTimeout(3500)
      if (DEBUG_MODE) await dumpDebugPage(targetPage, "stage-course-after-open")
      const tables = await collectTablesInAllFrames(targetPage)
      const api = monitor.get()
      monitor.stop()
      const title = await safeTitle(targetPage)
      return {
        opened: true,
        title,
        tables,
        api,
        debug: {
          appName: TXT.myCourseTableZh,
          fallbackName: TXT.courseTableZh,
          clickedCard: false,
          clickedEnter: false,
          directOpened: true,
          urlBefore: page.url(),
          urlAfter: page.url(),
          appMeta: { appId: "4770397878132218" },
          switchedToNewPage: true,
          targetPageUrl: targetPage.url(),
          directHitUrl: "portal-force-open-by-appid",
          visibleMatches: [],
        },
      }
    }
    monitor.stop()
    return {
      opened: false,
      title: "",
      tables: [],
      api: [],
      note: "Could not open course app.",
      debug: openResult.debug,
    }
  }

  const targetPage = openResult.targetPage || page
  await targetPage.waitForTimeout(3500)
  if (DEBUG_MODE) await dumpDebugPage(targetPage, "stage-course-after-open")
  const tables = await collectTablesInAllFrames(targetPage)
  const api = monitor.get()
  monitor.stop()
  const title = await safeTitle(targetPage)
  if (!tables.length && !api.length) {
    // Keep course crawl resilient when page is slow/blank on first entry.
    return { opened: true, title, tables, api, note: "Course page opened but no data captured yet.", debug: openResult.debug }
  }
  return { opened: true, title, tables, api, debug: openResult.debug }
}

async function collectScoreData(context, page) {
  const monitor = await captureNetworkJson(context, [
    "score",
    "grade",
    "cj",
    "chengji",
    "cjcx",
    "xscjcx",
    "jddzpjcxcj",
    TXT.scoreZh,
  ])
  let workingPage = page
  if (!isEhallPortalUrl(workingPage.url()) || !/\/new\/index\.html/i.test(workingPage.url())) {
    const backPage = await backToPortalHome(context, workingPage).catch(() => null)
    if (backPage) workingPage = backPage
  }
  if (!/\/new\/index\.html/i.test(workingPage.url())) {
    await workingPage.goto(ENTRY_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch(() => {})
    await waitForEhallPortal(workingPage, WAIT_MS).catch(() => {})
  }
  await ensureStudentRole(workingPage).catch(() => {})
  if (DEBUG_MODE) await dumpDebugPage(workingPage, "stage-score-before")

  const openResult = await findAndOpenApp(
    context,
    workingPage,
    TXT.scoreQueryZh,
    TXT.postgradScoreQueryZh,
    /\/jwapp\/sys\/cjcx\//i,
    [],
    { strictPrimary: true, strictFallback: false }
  )
  if (openResult.debug && openResult.debug.clickedCard && !openResult.debug.clickedEnter) {
    console.log("[xjtu-crawler] Service card clicked but enter-service not confirmed yet.")
  }
  let finalOpenResult = openResult
  if (!finalOpenResult.opened) {
    const forced = await openTargetAppByPortal(context, "4768574631264620", /\/jwapp\/sys\/cjcx\//i).catch(() => null)
    if (forced) {
      finalOpenResult = {
        opened: true,
        targetPage: forced,
        debug: {
          ...(openResult.debug || {}),
          appName: TXT.scoreQueryZh,
          fallbackName: TXT.postgradScoreQueryZh,
          directOpened: true,
          directHitUrl: "portal-force-open-by-appid",
          switchedToNewPage: true,
          targetPageUrl: forced.url(),
          clickedEnter: true,
        },
      }
    }
  }
  if (!finalOpenResult.opened) {
    monitor.stop()
    return {
      opened: false,
      title: "",
      tables: [],
      api: [],
      note: finalOpenResult.note || "Could not open score app.",
      debug: finalOpenResult.debug,
    }
  }

  const targetPage = finalOpenResult.targetPage || page
  const prepare = await prepareScoreQueryPage(targetPage).catch(() => ({
    clickedAllTab: false,
    clickedAllFallback: false,
    clickedQuery: false,
  }))
  await targetPage.waitForTimeout(3500)
  let api = monitor.get()
  if (prepare.clickedAllTab && !hasScoreApiData(api)) {
    const retryPrepare = await prepareScoreQueryPage(targetPage).catch(() => ({
      clickedAllTab: false,
      clickedAllFallback: false,
      clickedQuery: false,
    }))
    await targetPage.waitForTimeout(2000)
    api = monitor.get()
    prepare.retry = retryPrepare
  }

  const pagerSummaryFirst = await readScorePagerSummary(targetPage).catch(() => ({
    totalSize: 0,
    totalPages: 0,
    pageSize: 0,
    numText: "",
    noText: "",
  }))
  const collectedPages = extractScorePagesFromApi(api)
  let totalPages = toPositiveInt(pagerSummaryFirst.totalPages, 0)
  if (!totalPages && collectedPages.length) {
    const firstSize = toPositiveInt(collectedPages[0].pageSize, 0)
    const firstTotal = toPositiveInt(collectedPages[0].totalSize, 0)
    if (firstSize > 0 && firstTotal > 0) totalPages = Math.ceil(firstTotal / firstSize)
  }
  if (!totalPages) totalPages = 1

  const pageFetchLog = []
  for (let pageNo = 2; pageNo <= totalPages; pageNo++) {
    const hasPage = extractScorePagesFromApi(monitor.get()).some((p) => p.pageNumber === pageNo)
    if (!hasPage) {
      const clickedNext = await clickScorePagerNext(targetPage)
      pageFetchLog.push({ pageNumber: pageNo, clickedNext })
      if (!clickedNext) break
    } else {
      pageFetchLog.push({ pageNumber: pageNo, clickedNext: false, skipped: true })
    }

    const waitResult = await waitForScorePageCaptured(targetPage, monitor, pageNo, 12000)
    pageFetchLog[pageFetchLog.length - 1].captured = waitResult.ok
    if (!waitResult.ok) {
      const retryClicked = await clickScorePagerNext(targetPage)
      pageFetchLog[pageFetchLog.length - 1].retryClickedNext = retryClicked
      if (retryClicked) {
        const retryWait = await waitForScorePageCaptured(targetPage, monitor, pageNo, 10000)
        pageFetchLog[pageFetchLog.length - 1].retryCaptured = retryWait.ok
      }
    }
  }

  await targetPage.waitForTimeout(800)
  api = monitor.get()
  const scorePages = extractScorePagesFromApi(api)
  const mergedRows = mergeScoreRows(scorePages)
  const pagerSummaryFinal = await readScorePagerSummary(targetPage).catch(() => pagerSummaryFirst)
  const pageSummary = buildScorePageSummary(scorePages, pagerSummaryFinal)

  if (DEBUG_MODE) await dumpDebugPage(targetPage, "stage-score-after-open")
  const tables = await collectTablesInAllFrames(targetPage)
  monitor.stop()
  const title = await safeTitle(targetPage)
  return {
    opened: true,
    title,
    tables,
    api,
    allRows: mergedRows,
    pages: scorePages.map((p) => ({
      pageNumber: p.pageNumber,
      pageSize: p.pageSize,
      totalSize: p.totalSize,
      rowCount: Array.isArray(p.rows) ? p.rows.length : 0,
    })),
    pageSummary,
    debug: {
      ...finalOpenResult.debug,
      scorePrepare: prepare,
      scorePager: {
        initial: pagerSummaryFirst,
        final: pagerSummaryFinal,
        fetchLog: pageFetchLog,
      },
    },
  }
}

async function run() {
  const browser = await launchBrowser()
  const context = await browser.newContext()
  const page = await context.newPage()
  const ops = TRACE_OPS ? createOpsRecorder({ maxEvents: MAX_OP_EVENTS }) : null
  let detachOpsContext = null
  let opsSaved = false

  const result = {
    meta: {
      entry: ENTRY_URL,
      fetchedAt: nowIso(),
      headless: HEADLESS,
      manualLogin: MANUAL_LOGIN,
      traceOps: TRACE_OPS,
      monitorOnly: MONITOR_ONLY,
      crawlTarget: SAFE_CRAWL_TARGET,
    },
    course: null,
    score: null,
  }

  try {
    console.log(`[xjtu-crawler] Mode: traceOps=${TRACE_OPS}, monitorOnly=${MONITOR_ONLY}`)

    if (ops) {
      detachOpsContext = ops.attachContext(context)
      ops.push({ type: "trace-start", url: page.url() })
    }

    const loggedInPage = await loginToEhall(page)
    const mainPage = loggedInPage || page

    if (ops) ops.push({ type: "after-login", url: mainPage.url() })

    if (MONITOR_ONLY) {
      console.log("[xjtu-crawler] Monitor-only mode.")
      console.log("[xjtu-crawler] Please manually open:")
      console.log("[xjtu-crawler] 1) 我的本研课表")
      console.log("[xjtu-crawler] 2) 成绩查询")
      if (process.stdin.isTTY) {
        console.log("[xjtu-crawler] Type done at each milestone, then type finish to export logs.")
        const checkpoints = []
        let checkpointIndex = 0

        while (true) {
          const cmd = await new Promise((resolve) => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
            rl.question("[xjtu-crawler] Input command (done/finish): ", (input) => {
              rl.close()
              resolve(String(input || "").trim().toLowerCase())
            })
          })

          if (cmd === "done") {
            checkpointIndex += 1
            const shot = await captureMonitorCheckpoint(context, ops, checkpointIndex)
            checkpoints.push({ checkpointIndex, pages: shot, at: nowIso() })
            console.log(`[xjtu-crawler] Checkpoint ${checkpointIndex} saved.`)
            continue
          }

          if (cmd === "finish") {
            if (!checkpoints.length) {
              console.log("[xjtu-crawler] No checkpoint yet. Type done at least once before finish.")
              continue
            }

            const pages = context.pages().map((p, idx) => ({
              index: idx,
              url: p.url(),
              title: "",
            }))
            for (let i = 0; i < context.pages().length; i++) {
              pages[i].title = await context.pages()[i].title().catch(() => "")
            }

            if (ops) {
              ops.push({
                type: "monitor-finish",
                currentUrl: page.url(),
                pageCount: pages.length,
                checkpointCount: checkpoints.length,
              })
              ops.save(OPS_OUTPUT_PATH, { pages, checkpoints })
              opsSaved = true
            }

            ensureDir(OUTPUT_PATH)
            fs.writeFileSync(
              path.resolve(OUTPUT_PATH),
              JSON.stringify(
                {
                  meta: result.meta,
                  monitorOnly: true,
                  opsLog: path.resolve(OPS_OUTPUT_PATH),
                  pages,
                  checkpoints,
                },
                null,
                2
              ),
              "utf-8"
            )
            console.log(`[xjtu-crawler] Monitor log exported: ${path.resolve(OPS_OUTPUT_PATH)}`)
            console.log(`[xjtu-crawler] Summary output: ${path.resolve(OUTPUT_PATH)}`)
            return
          }

          console.log("[xjtu-crawler] Unknown command. Please input done or finish.")
        }
      } else {
        console.log(`[xjtu-crawler] Non-interactive terminal, waiting ${MONITOR_WAIT_MS} ms before export...`)
        await page.waitForTimeout(MONITOR_WAIT_MS)

        const shot = await captureMonitorCheckpoint(context, ops, 1)
        const pages = context.pages().map((p, idx) => ({
          index: idx,
          url: p.url(),
          title: "",
        }))
        for (let i = 0; i < context.pages().length; i++) {
          pages[i].title = await context.pages()[i].title().catch(() => "")
        }
        const checkpoints = [{ checkpointIndex: 1, pages: shot, at: nowIso() }]

        if (ops) {
          ops.push({ type: "monitor-finish", currentUrl: page.url(), pageCount: pages.length, checkpointCount: 1 })
          ops.save(OPS_OUTPUT_PATH, { pages, checkpoints })
          opsSaved = true
        }

        ensureDir(OUTPUT_PATH)
        fs.writeFileSync(
          path.resolve(OUTPUT_PATH),
          JSON.stringify(
            {
              meta: result.meta,
              monitorOnly: true,
              opsLog: path.resolve(OPS_OUTPUT_PATH),
              pages,
              checkpoints,
            },
            null,
            2
          ),
          "utf-8"
        )
        console.log(`[xjtu-crawler] Monitor log exported: ${path.resolve(OPS_OUTPUT_PATH)}`)
        console.log(`[xjtu-crawler] Summary output: ${path.resolve(OUTPUT_PATH)}`)
        return
      }
    }

    if (SAFE_CRAWL_TARGET === TARGET_COURSE) {
      console.log("[xjtu-crawler] Target mode: course")
      result.course = await collectCourseData(context, mainPage)
    } else if (SAFE_CRAWL_TARGET === TARGET_SCORE) {
      console.log("[xjtu-crawler] Target mode: score")
      result.score = await collectScoreData(context, mainPage)
    } else {
      console.log("[xjtu-crawler] Target mode: all")
      result.course = await collectCourseData(context, mainPage)
      console.log("[xjtu-crawler] Course done. Closing course pages and returning to ehall home...")
      const scoreStartPage = await closeCoursePagesAndReturnHome(context, mainPage).catch(() => mainPage)
      result.score = await collectScoreData(context, scoreStartPage || mainPage)
    }

    const existingOutput = readExistingOutput(OUTPUT_PATH)
    const mergedSections = pickFinalSection(SAFE_CRAWL_TARGET, result, existingOutput)
    const finalOutput = {
      ...(existingOutput && typeof existingOutput === "object" ? existingOutput : {}),
      meta: {
        ...((existingOutput && existingOutput.meta && typeof existingOutput.meta === "object")
          ? existingOutput.meta
          : {}),
        ...result.meta,
      },
      course: mergedSections.course,
      score: mergedSections.score,
      error: "",
    }

    ensureDir(OUTPUT_PATH)
    fs.writeFileSync(path.resolve(OUTPUT_PATH), JSON.stringify(finalOutput, null, 2), "utf-8")
    if (ops) {
      ops.save(OPS_OUTPUT_PATH, {
        pages: context.pages().map((p, idx) => ({ index: idx, url: p.url() })),
      })
      opsSaved = true
      console.log(`[xjtu-crawler] Ops log: ${path.resolve(OPS_OUTPUT_PATH)}`)
    }
    console.log(`[xjtu-crawler] Done. Output: ${path.resolve(OUTPUT_PATH)}`)
  } catch (err) {
    console.error("[xjtu-crawler] Failed:", err.message)
    const existingOutput = readExistingOutput(OUTPUT_PATH)
    const failedOutput = {
      ...(existingOutput && typeof existingOutput === "object" ? existingOutput : {}),
      meta: {
        ...((existingOutput && existingOutput.meta && typeof existingOutput.meta === "object")
          ? existingOutput.meta
          : {}),
        entry: ENTRY_URL,
        fetchedAt: nowIso(),
        headless: HEADLESS,
        manualLogin: MANUAL_LOGIN,
        crawlTarget: SAFE_CRAWL_TARGET,
      },
      error: err.message,
    }
    ensureDir(OUTPUT_PATH)
    fs.writeFileSync(
      path.resolve(OUTPUT_PATH),
      JSON.stringify(failedOutput, null, 2),
      "utf-8"
    )
    process.exitCode = 1

    if (ops && !opsSaved) {
      ops.save(OPS_OUTPUT_PATH, {
        error: clipText(err.message, 500),
        pages: context.pages().map((p, idx) => ({ index: idx, url: p.url() })),
      })
      opsSaved = true
      console.error(`[xjtu-crawler] Ops log (failure): ${path.resolve(OPS_OUTPUT_PATH)}`)
    }
  } finally {
    if (detachOpsContext) detachOpsContext()
    if (ops) ops.stopAll()
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

run()
