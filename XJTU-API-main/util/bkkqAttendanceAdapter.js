"use strict"

const fs = require("fs")
const path = require("path")

function sanitizeStuId(stuId) {
  return String(stuId || "")
    .trim()
    .replace(/[^\d]/g, "")
}

function resolveBkkqOutputPath(stuId = "") {
  const safeStuId = sanitizeStuId(stuId)
  if (safeStuId) {
    return path.resolve(__dirname, "..", "output", `xjtu-bkkq-attendance-${safeStuId}.json`)
  }
  return path.resolve(__dirname, "..", "output", "xjtu-bkkq-attendance.json")
}

function toText(v) {
  if (v === null || v === undefined) return ""
  return String(v).replace(/\s+/g, " ").trim()
}

function toCount(v, fallback = 0) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.trunc(v))
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

function isKnownTermText(text) {
  const t = toText(text)
  return t === "本周" || t === "本月" || t === "本学期"
}

function normalizeRisk(absences, late, leave) {
  const score = toCount(absences) * 2 + toCount(late) + toCount(leave)
  if (score >= 6) return "danger"
  if (score >= 2) return "warning"
  return "normal"
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const content = fs.readFileSync(filePath, "utf-8")
    if (!content || !content.trim()) return null
    return JSON.parse(content)
  } catch (_) {
    return null
  }
}

function normalizeAttendanceList(rawList) {
  const list = Array.isArray(rawList) ? rawList : []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const courseName = toText(item.courseName || item.course || item.kcmc)
    if (!courseName) continue
    let teacher = toText(item.teacher || item.jsxm || item.instructor)
    let term = toText(item.term || item.termName || "本学期")
    // Data correction: some rows put term text into teacher field.
    if (!isKnownTermText(term) && isKnownTermText(teacher)) {
      term = teacher
      teacher = ""
    }
    const shouldAttend = toCount(item.shouldAttend || item.yingdao || item.totalCount || item.totalClasses)
    const actualAttend = toCount(item.actualAttend || item.shidao || item.presentCount || item.attendedCount)
    const normalCount = toCount(item.normalCount || item.normal || item.zhengchang)
    const absences = toCount(item.absences || item.absent || item.qq || item.queqin || item.missed)
    const late = toCount(item.late || item.cd || item.chidao)
    const leave = toCount(item.leave || item.qj || item.qingjia)
    const attendanceRate = toRate(item.attendanceRate || item.daoKelv || item.rate || item.presentRate)
    out.push({
      id: toText(item.id) || "",
      courseName,
      teacher,
      term,
      shouldAttend,
      actualAttend,
      normalCount,
      absences,
      late,
      leave,
      attendanceRate,
      risk: normalizeRisk(absences, late, leave),
      raw: item.raw || null,
    })
  }
  return out
}

function normalizeTermText(text) {
  const t = toText(text)
  if (t.includes("本周")) return "本周"
  if (t.includes("本月")) return "本月"
  if (t.includes("本学期")) return "本学期"
  return "本学期"
}

function normalizeSummary(rawSummary) {
  const summary = rawSummary && typeof rawSummary === "object" ? rawSummary : {}
  const shouldAttend = toCount(summary.shouldAttend || summary.yingdao || summary.total)
  const normalCount = toCount(summary.normalCount || summary.normal || summary.zhengchang)
  const late = toCount(summary.late || summary.cd || summary.chidao)
  const leave = toCount(summary.leave || summary.qj || summary.qingjia)
  const absences = toCount(summary.absences || summary.absent || summary.qq || summary.queqin)
  const actualAttend = Math.max(0, normalCount + late + leave)
  const attendanceRate = shouldAttend > 0 ? `${((actualAttend / shouldAttend) * 100).toFixed(2)}%` : ""
  return {
    shouldAttend,
    actualAttend,
    normalCount,
    late,
    leave,
    absences,
    attendanceRate,
  }
}

function normalizeAttendanceByTab(rawByTab) {
  const source = rawByTab && typeof rawByTab === "object" ? rawByTab : {}
  return {
    week: normalizeAttendanceList(source.week),
    month: normalizeAttendanceList(source.month),
    term: normalizeAttendanceList(source.term),
  }
}

function buildByTabFromList(list) {
  const rows = Array.isArray(list) ? list : []
  return {
    week: rows.filter((item) => normalizeTermText(item && item.term) === "本周"),
    month: rows.filter((item) => normalizeTermText(item && item.term) === "本月"),
    term: rows.filter((item) => normalizeTermText(item && item.term) === "本学期"),
  }
}

function pickBestByTab(normalizedByTab, list) {
  const byTab = normalizedByTab && typeof normalizedByTab === "object" ? normalizedByTab : {}
  const hasDirect =
    (Array.isArray(byTab.week) && byTab.week.length > 0) ||
    (Array.isArray(byTab.month) && byTab.month.length > 0) ||
    (Array.isArray(byTab.term) && byTab.term.length > 0)
  if (hasDirect) {
    return {
      week: Array.isArray(byTab.week) ? byTab.week : [],
      month: Array.isArray(byTab.month) ? byTab.month : [],
      term: Array.isArray(byTab.term) ? byTab.term : [],
    }
  }
  return buildByTabFromList(list)
}

function getMappedBkkqAttendanceData(stuId = "") {
  const sourceFile = resolveBkkqOutputPath(stuId)
  const raw = readJson(sourceFile)
  if (!raw) return null

  const list = normalizeAttendanceList(raw.attendance)
  const byTab = pickBestByTab(normalizeAttendanceByTab(raw.attendanceByTab), list)
  const summary = normalizeSummary(raw.summary)
  const rawTables =
    raw && raw.raw && Array.isArray(raw.raw.tables)
      ? raw.raw.tables.map((table) => ({
          headers: Array.isArray(table && table.headers) ? table.headers.map((v) => toText(v)) : [],
          rows: Array.isArray(table && table.rows)
            ? table.rows.map((row) => (Array.isArray(row) ? row.map((v) => toText(v)) : []))
            : [],
        }))
      : []

  return {
    list,
    total: list.length,
    fetchedAt: toText((raw.meta && raw.meta.fetchedAt) || raw.fetchedAt),
    sourceFile,
    error: toText(raw.error),
    meta: raw.meta || {},
    summary,
    byTab,
    rawTables,
  }
}

module.exports = {
  sanitizeStuId,
  resolveBkkqOutputPath,
  getMappedBkkqAttendanceData,
}
