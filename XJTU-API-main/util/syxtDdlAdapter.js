"use strict"

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

function sanitizeStuId(stuId) {
  return String(stuId || "")
    .trim()
    .replace(/[^\d]/g, "")
}

function resolveSyxtDdlOutputPath(stuId = "") {
  const safeStuId = sanitizeStuId(stuId)
  if (safeStuId) {
    return path.resolve(__dirname, "..", "output", `xjtu-syxt-ddl-${safeStuId}.json`)
  }
  return path.resolve(__dirname, "..", "output", "xjtu-syxt-ddl.json")
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const content = fs.readFileSync(filePath, "utf-8")
    if (!content || !content.trim()) return null
    return JSON.parse(content)
  } catch (_) {
    return null
  }
}

function toText(v) {
  if (v === null || v === undefined) return ""
  return String(v).replace(/\s+/g, " ").trim()
}

function normalizeDeadline(v) {
  const raw = toText(v)
  if (!raw) return ""
  const normalized = raw.replace(/[./]/g, "-")
  return normalized
}

function buildItemId(item) {
  const base = [toText(item.title), toText(item.course), normalizeDeadline(item.deadline)].join("|")
  return `ddl-${crypto.createHash("md5").update(base).digest("hex").slice(0, 12)}`
}

function normalizeItem(item) {
  const title = toText(item.title || item.taskName || item.name || item.homeworkName || item.workName)
  const course = toText(item.course || item.courseName || item.className || item.kcmc)
  const deadline = normalizeDeadline(item.deadline || item.endTime || item.dueTime || item.jzsj || item.endDate)
  if (!title && !course && !deadline) return null
  if (!title || !deadline) return null
  const out = {
    id: "",
    title,
    course,
    deadline,
    done: false,
  }
  out.id = buildItemId(out)
  return out
}

function dedupeItems(items) {
  const map = new Map()
  for (const item of items || []) {
    if (!item || !item.id) continue
    if (!map.has(item.id)) map.set(item.id, item)
  }
  return Array.from(map.values())
}

function toSortableTime(deadline) {
  const t = Date.parse(String(deadline || "").replace(/\./g, "-").replace(/\//g, "-"))
  if (!Number.isFinite(t)) return Number.MAX_SAFE_INTEGER
  return t
}

function getMappedSyxtDdlData(stuId = "") {
  const sourceFile = resolveSyxtDdlOutputPath(stuId)
  const raw = readJsonFile(sourceFile)
  if (!raw) return null

  const rawItems = Array.isArray(raw.items) ? raw.items : []
  const normalized = rawItems.map(normalizeItem).filter(Boolean)
  const list = dedupeItems(normalized).sort((a, b) => toSortableTime(a.deadline) - toSortableTime(b.deadline))

  return {
    list,
    total: list.length,
    fetchedAt: toText((raw.meta && raw.meta.fetchedAt) || raw.fetchedAt),
    sourceFile,
    error: toText(raw.error),
  }
}

module.exports = {
  sanitizeStuId,
  resolveSyxtDdlOutputPath,
  getMappedSyxtDdlData,
}

