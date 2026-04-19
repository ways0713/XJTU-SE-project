"use strict"

const fs = require("fs")
const path = require("path")

let crawlerCache = {
  filePath: "",
  mtimeMs: 0,
  data: null,
}

function resolveCrawlerOutputPath() {
  const configuredPath = process.env.XJTU_OUTPUT || "./output/xjtu-ehall.json"
  if (path.isAbsolute(configuredPath)) {
    return configuredPath
  }
  return path.resolve(__dirname, "..", configuredPath)
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ""
}

function toText(value) {
  if (!hasValue(value)) return ""
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value)
  }
  return String(value).trim()
}

function toInt(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function toNumber(value, fallback = NaN) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function firstNonEmpty(list) {
  for (const item of list) {
    if (hasValue(item)) return toText(item)
  }
  return ""
}

function pickScoreValue(rawValue, displayValue) {
  const display = toText(displayValue)
  if (display) return display
  const raw = toText(rawValue)
  if (!raw) return ""
  if (/^-\d+$/.test(raw)) return ""
  return raw
}

function readCrawlerOutput() {
  const filePath = resolveCrawlerOutputPath()
  if (!fs.existsSync(filePath)) {
    return null
  }

  const stat = fs.statSync(filePath)
  if (
    crawlerCache.data &&
    crawlerCache.filePath === filePath &&
    crawlerCache.mtimeMs === stat.mtimeMs
  ) {
    return crawlerCache.data
  }

  const raw = fs.readFileSync(filePath, "utf8")
  const json = JSON.parse(raw)

  crawlerCache = {
    filePath,
    mtimeMs: stat.mtimeMs,
    data: json,
  }

  return json
}

function extractRowsFromApiList(apiList, targetDataKey = "") {
  if (!Array.isArray(apiList) || !apiList.length) return []
  const rows = []

  for (const item of apiList) {
    const datas = item && item.data && item.data.datas
    if (!datas || typeof datas !== "object") continue

    if (targetDataKey) {
      const block = datas[targetDataKey]
      if (block && Array.isArray(block.rows)) {
        rows.push(...block.rows)
      }
      continue
    }

    for (const key of Object.keys(datas)) {
      const block = datas[key]
      if (block && Array.isArray(block.rows)) {
        rows.push(...block.rows)
      }
    }
  }

  return rows
}

function parseWeeksFromBitmask(bitmask) {
  const source = toText(bitmask).replace(/[^01]/g, "")
  if (!source) return []
  const weeks = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "1") weeks.push(i + 1)
  }
  return weeks
}

function parseWeeksFromText(rawWeekText) {
  const text = toText(rawWeekText)
  if (!text) return []

  const isOdd = /单周/.test(text)
  const isEven = /双周/.test(text)
  let normalized = text
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/周/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .replace(/，/g, ",")

  if (!normalized) return []
  const parts = normalized.split(",").map((x) => x.trim()).filter(Boolean)
  const weeks = []

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = toInt(rangeMatch[1], 0)
      const end = toInt(rangeMatch[2], 0)
      if (start <= 0 || end <= 0 || end < start) continue
      for (let i = start; i <= end; i++) {
        if (isOdd && i % 2 === 0) continue
        if (isEven && i % 2 !== 0) continue
        weeks.push(i)
      }
      continue
    }

    const oneMatch = part.match(/^(\d+)$/)
    if (oneMatch) {
      const week = toInt(oneMatch[1], 0)
      if (!week) continue
      if (isOdd && week % 2 === 0) continue
      if (isEven && week % 2 !== 0) continue
      weeks.push(week)
    }
  }

  return Array.from(new Set(weeks)).sort((a, b) => a - b)
}

function formatWeeksToText(weeks) {
  if (!Array.isArray(weeks) || !weeks.length) return ""
  const sorted = Array.from(new Set(weeks.map((x) => toInt(x, 0)).filter((x) => x > 0))).sort(
    (a, b) => a - b
  )
  if (!sorted.length) return ""

  const segments = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]
    if (curr === prev + 1) {
      prev = curr
      continue
    }
    segments.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = curr
    prev = curr
  }
  segments.push(start === prev ? `${start}` : `${start}-${prev}`)
  return `${segments.join(",")}周`
}

function buildCourseMetaByCourseNo(scoreRows) {
  const map = new Map()
  for (const row of scoreRows) {
    const courseNo = toText(row && row.KCH)
    if (!courseNo || map.has(courseNo)) continue
    map.set(courseNo, {
      credit: toText(row.XF),
      category: firstNonEmpty([row.KCLBDM_DISPLAY, row.KCLBDM]),
      method: firstNonEmpty([row.KSLXDM_DISPLAY, row.KSLXDM]),
    })
  }
  return map
}

function extractCourseRows(crawlerData) {
  const directRows = extractRowsFromApiList(
    crawlerData && crawlerData.course && crawlerData.course.api,
    "xskcb"
  )
  if (directRows.length) return directRows
  return []
}

function extractScoreRows(crawlerData) {
  const rows = Array.isArray(crawlerData && crawlerData.score && crawlerData.score.allRows)
    ? crawlerData.score.allRows
    : []
  if (rows.length) return rows

  const fallback = extractRowsFromApiList(crawlerData && crawlerData.score && crawlerData.score.api)
  return fallback.filter((row) => row && hasValue(row.KCM) && (hasValue(row.ZCJ) || hasValue(row.XF)))
}

function toTermName(row) {
  return firstNonEmpty([row && row.XNXQDM_DISPLAY, row && row.XNXQMC, row && row.XNXQDM]) || "未知学期"
}

function buildScoreUniqueKey(row) {
  const wid = toText(row && row.WID)
  if (wid) return `wid:${wid}`
  return [
    "fallback",
    toText(row && row.XNXQDM),
    toText(row && row.KCH),
    toText(row && row.KCM),
    toText(row && row.KXH),
    toText(row && row.ZCJ),
  ].join("|")
}

function normalizeScoreRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return []
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const key = buildScoreUniqueKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function pickFinalScore(row) {
  return firstNonEmpty([
    pickScoreValue(row && row.ZCJ, row && row.ZCJ_DISPLAY),
    row && row.DJCJMC,
    pickScoreValue(row && row.QMCJ, row && row.QMCJ_DISPLAY),
    pickScoreValue(row && row.SYCJ, row && row.SYCJ_DISPLAY),
    pickScoreValue(row && row.SJCJ, row && row.SJCJ_DISPLAY),
    pickScoreValue(row && row.PSCJ, row && row.PSCJ_DISPLAY),
    pickScoreValue(row && row.QZCJ, row && row.QZCJ_DISPLAY),
  ])
}

function isValidScoreRow(row) {
  const sfyx = toText(row && row.SFYX)
  const sfyxDisplay = toText(row && row.SFYX_DISPLAY)
  if (sfyx === "1") return true
  if (sfyxDisplay === "是") return true
  if (!sfyx && !sfyxDisplay) return true
  return false
}

function formatGPAFromRow(row) {
  const xfjdNum = toNumber(row && row.XFJD, NaN)
  if (Number.isFinite(xfjdNum)) {
    const gpa = Number.isInteger(xfjdNum)
      ? String(xfjdNum)
      : xfjdNum.toFixed(2).replace(/\.?0+$/, "")
    return gpa
  }
  return toText(row && row.JD) || toText(row && row.XFJD)
}

function mapCrawlerCourseList(crawlerData) {
  const courseRows = extractCourseRows(crawlerData)
  if (!courseRows.length) return []

  const scoreRows = normalizeScoreRows(extractScoreRows(crawlerData))
  const courseMeta = buildCourseMetaByCourseNo(scoreRows)

  const mapped = courseRows
    .map((row) => {
      const section = Math.max(1, toInt(row.KSJC, 1))
      const endSection = Math.max(section, toInt(row.JSJC, section))
      const sectionCount = Math.max(1, endSection - section + 1)
      const week = Math.min(7, Math.max(1, toInt(row.SKXQ, 1)))
      const weeksFromMask = parseWeeksFromBitmask(row.SKZC)
      const weeksFromText = parseWeeksFromText(row.ZCMC)
      const weeks = weeksFromMask.length ? weeksFromMask : weeksFromText

      const courseNo = toText(row.KCH)
      const meta = courseMeta.get(courseNo) || {}

      return {
        name: toText(row.KCM),
        num: courseNo,
        credit: toText(meta.credit),
        category: toText(meta.category),
        method: toText(meta.method),
        teacher: toText(row.SKJS),
        weeks,
        section,
        address: toText(row.JASMC),
        rawWeeks: toText(row.ZCMC) || formatWeeksToText(weeks),
        rawSection: `${section}-${endSection}节`,
        week,
        sectionCount,
      }
    })
    .filter((item) => item.name && item.week >= 1 && item.week <= 7)
    .sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week
      if (a.section !== b.section) return a.section - b.section
      return a.name.localeCompare(b.name, "zh-Hans-CN")
    })

  return mapped
}

function mapTermGroupedScoreList(rows, buildItem) {
  const termMap = new Map()

  for (const row of rows) {
    const termName = toTermName(row)
    if (!termMap.has(termName)) {
      termMap.set(termName, [])
    }
    termMap.get(termName).push(buildItem(row))
  }

  return Array.from(termMap.entries()).map(([termName, scoreList]) => ({
    termName,
    scoreList,
  }))
}

function mapCrawlerScoreList(crawlerData) {
  const rawRows = normalizeScoreRows(extractScoreRows(crawlerData))
  if (!rawRows.length) return []

  const validRows = rawRows.filter(isValidScoreRow)
  const rows = validRows.length ? validRows : rawRows

  return mapTermGroupedScoreList(rows, (row) => {
    const GPA = formatGPAFromRow(row)
    const credit = toText(row.XF)
    return {
      num: toText(row.KCH),
      name: toText(row.KCM),
      courseCredit: credit,
      category: firstNonEmpty([row.KCLBDM_DISPLAY, row.KCLBDM]),
      courseCategory: firstNonEmpty([row.KCXZDM_DISPLAY, row.KCXZDM]),
      method: firstNonEmpty([row.KSLXDM_DISPLAY, row.KSLXDM]),
      property: firstNonEmpty([row.CXCKDM_DISPLAY, row.XDFSDM_DISPLAY, row.CXCKDM, row.XDFSDM]),
      score: pickFinalScore(row),
      credit,
      GPA,
      mark: toText(row.BZ),
    }
  })
}

function mapCrawlerRawScoreList(crawlerData) {
  const rows = normalizeScoreRows(extractScoreRows(crawlerData))
  if (!rows.length) return []

  return mapTermGroupedScoreList(rows, (row) => {
    const credit = toText(row.XF)
    return {
      num: toText(row.KCH),
      name: toText(row.KCM),
      courseCredit: credit,
      category: firstNonEmpty([row.KCLBDM_DISPLAY, row.KCLBDM]),
      courseCategory: firstNonEmpty([row.KCXZDM_DISPLAY, row.KCXZDM]),
      method: firstNonEmpty([row.KSLXDM_DISPLAY, row.KSLXDM]),
      property: firstNonEmpty([row.CXCKDM_DISPLAY, row.XDFSDM_DISPLAY, row.CXCKDM, row.XDFSDM]),
      normalScore: pickScoreValue(row.PSCJ, row.PSCJ_DISPLAY),
      midtermScore: pickScoreValue(row.QZCJ, row.QZCJ_DISPLAY),
      finalScore: pickScoreValue(row.QMCJ, row.QMCJ_DISPLAY),
      skillScore: firstNonEmpty([
        pickScoreValue(row.SYCJ, row.SYCJ_DISPLAY),
        pickScoreValue(row.SJCJ, row.SJCJ_DISPLAY),
      ]),
      complexScore: pickFinalScore(row),
      minorMark: "",
      mark: toText(row.BZ),
    }
  })
}

function getMappedCrawlerData() {
  try {
    const crawlerData = readCrawlerOutput()
    if (!crawlerData || typeof crawlerData !== "object") {
      return null
    }

    const courseList = mapCrawlerCourseList(crawlerData)
    const scoreList = mapCrawlerScoreList(crawlerData)
    const rawScoreList = mapCrawlerRawScoreList(crawlerData)

    return {
      courseList,
      scoreList,
      rawScoreList,
      sourceFile: resolveCrawlerOutputPath(),
    }
  } catch (_) {
    return null
  }
}

module.exports = {
  getMappedCrawlerData,
}
