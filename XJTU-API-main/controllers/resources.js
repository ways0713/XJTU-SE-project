const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const MATERIALS_ROOT = path.resolve(PROJECT_ROOT, "public", "materials")
const META_FILE = path.resolve(MATERIALS_ROOT, ".meta.json")

const ALLOWED_EXTS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".zip",
  ".rar",
  ".7z",
  ".txt",
  ".md",
  ".jpg",
  ".jpeg",
  ".png",
])

function ensureMaterialsRoot() {
  if (!fs.existsSync(MATERIALS_ROOT)) {
    fs.mkdirSync(MATERIALS_ROOT, { recursive: true })
  }
}

function toPositiveInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  return i > 0 ? i : fallback
}

function normalizeText(v, fallback = "") {
  const s = String(v || "").trim()
  return s || fallback
}

function sanitizeCourseName(name) {
  return normalizeText(name, "未分类课程").replace(/[\\/:*?"<>|]/g, "_")
}

function sanitizeFileName(name) {
  const safe = String(name || "resource").replace(/[\\/:*?"<>|]/g, "_").trim()
  return safe || "resource"
}

function getResourceTypeByExt(ext = "") {
  const e = String(ext || "").toLowerCase()
  if ([".pdf", ".ppt", ".pptx", ".doc", ".docx", ".md", ".txt"].includes(e)) return "courseware"
  if ([".zip", ".rar", ".7z"].includes(e)) return "exam"
  return "note"
}

function getUploaderFromToken(ctx) {
  const token = String((ctx && ctx.request && ctx.request.headers && ctx.request.headers.token) || "").trim()
  const m = token.match(/^xjtu-(\d+)-/i)
  return m ? m[1] : ""
}

function stableResourceId(relativePath) {
  return `res-${crypto.createHash("sha1").update(relativePath).digest("hex").slice(0, 16)}`
}

function loadMeta() {
  ensureMaterialsRoot()
  if (!fs.existsSync(META_FILE)) return {}
  try {
    const raw = fs.readFileSync(META_FILE, "utf8")
    const json = JSON.parse(raw)
    return json && typeof json === "object" ? json : {}
  } catch (_) {
    return {}
  }
}

function saveMeta(meta) {
  ensureMaterialsRoot()
  fs.writeFileSync(META_FILE, JSON.stringify(meta || {}, null, 2), "utf8")
}

function setMetaByRelativePath(relativePath, patch = {}) {
  const key = String(relativePath || "").replace(/\\/g, "/")
  if (!key) return
  const meta = loadMeta()
  meta[key] = {
    ...(meta[key] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  saveMeta(meta)
}

function getMetaByRelativePath(relativePath) {
  const key = String(relativePath || "").replace(/\\/g, "/")
  if (!key) return null
  const meta = loadMeta()
  return meta[key] || null
}

function removeMetaByRelativePath(relativePath) {
  const key = String(relativePath || "").replace(/\\/g, "/")
  if (!key) return
  const meta = loadMeta()
  if (Object.prototype.hasOwnProperty.call(meta, key)) {
    delete meta[key]
    saveMeta(meta)
  }
}

function walkMaterialFiles(dirPath, baseDir = dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) return acc
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      walkMaterialFiles(fullPath, baseDir, acc)
      continue
    }
    if (!entry.isFile()) continue
    if (path.resolve(fullPath) === path.resolve(META_FILE)) continue

    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/")
    const ext = path.extname(entry.name)
    const baseName = path.basename(entry.name, ext)
    const folderName = path.dirname(relativePath).replace(/\\/g, "/")
    const stat = fs.statSync(fullPath)
    const updatedAt = new Date(stat.mtimeMs).toISOString().slice(0, 10)
    const meta = getMetaByRelativePath(relativePath) || {}

    const displayName = normalizeText(meta.displayName || "", baseName)
    const uploader = normalizeText(meta.uploader || "", "XJTUhub")
    const id = stableResourceId(relativePath)

    acc.push({
      id,
      title: displayName,
      course: folderName && folderName !== "." ? folderName.split("/").pop() : "未分类课程",
      type: getResourceTypeByExt(ext),
      uploader,
      owner: uploader,
      updatedAt,
      desc: `文件：${entry.name}`,
      url: `/materials/${encodeURI(relativePath)}`,
      fileName: entry.name,
      relativePath,
    })
  }
  return acc
}

function sortResources(list = []) {
  return [...list].sort((a, b) => {
    const tA = Date.parse(a.updatedAt) || 0
    const tB = Date.parse(b.updatedAt) || 0
    if (tA !== tB) return tB - tA
    return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN")
  })
}

function buildResourceList() {
  ensureMaterialsRoot()
  const raw = walkMaterialFiles(MATERIALS_ROOT)
  return sortResources(raw)
}

const getList = async (ctx, next) => {
  const page = toPositiveInt(ctx.query.page, 1)
  const pageSize = toPositiveInt(ctx.query.pageSize, 10)
  const keyword = String(ctx.query.keyword || "").trim().toLowerCase()
  const category = String(ctx.query.category || "").trim().toLowerCase()
  const currentUser = getUploaderFromToken(ctx)

  let list = buildResourceList()

  if (category) {
    list = list.filter((item) => String(item.type || "").toLowerCase() === category)
  }

  if (keyword) {
    list = list.filter((item) => {
      const text = `${item.title} ${item.course} ${item.desc} ${item.uploader} ${item.fileName}`.toLowerCase()
      return text.includes(keyword)
    })
  }

  const listWithPermission = list.map((item) => ({
    ...item,
    canDelete: !!currentUser && currentUser === item.owner,
  }))

  const total = listWithPermission.length
  const start = (page - 1) * pageSize
  const end = start + pageSize
  const paged = listWithPermission.slice(start, end)
  const hasMore = end < total

  ctx.result = {
    list: paged,
    total,
    hasMore,
  }

  return next()
}

const uploadFile = async (ctx, next) => {
  ensureMaterialsRoot()

  const uploader = getUploaderFromToken(ctx)
  if (!uploader) {
    ctx.errMsg = "请先登录后再上传"
    return next()
  }

  const contentType = String(ctx.headers["content-type"] || "")
  if (!contentType.includes("multipart/form-data")) {
    ctx.errMsg = "请求必须是 multipart/form-data"
    return next()
  }

  const body = await new Promise((resolve, reject) => {
    let chunks = []
    ctx.req.on("data", (chunk) => chunks.push(chunk))
    ctx.req.on("end", () => resolve(Buffer.concat(chunks)))
    ctx.req.on("error", reject)
  }).catch((err) => {
    ctx.errMsg = `读取上传数据失败: ${err && err.message ? err.message : "unknown"}`
    return null
  })

  if (!body) return next()

  const boundaryMatch = contentType.match(/boundary=([^;]+)/i)
  if (!boundaryMatch) {
    ctx.errMsg = "上传边界缺失"
    return next()
  }
  const boundary = `--${boundaryMatch[1]}`
  const raw = body.toString("binary")
  const parts = raw.split(boundary).filter((part) => part && part !== "--\r\n" && part !== "--")

  let course = "未分类课程"
  let fileName = ""
  let displayName = ""
  let fileBuffer = null

  for (const part of parts) {
    const idx = part.indexOf("\r\n\r\n")
    if (idx < 0) continue
    const header = part.slice(0, idx)
    let contentBinary = part.slice(idx + 4)
    if (contentBinary.endsWith("\r\n")) {
      contentBinary = contentBinary.slice(0, -2)
    }
    if (contentBinary.endsWith("--")) {
      contentBinary = contentBinary.slice(0, -2)
    }

    const nameMatch = header.match(/name="([^"]+)"/i)
    const fieldName = nameMatch ? nameMatch[1] : ""

    const filenameMatch = header.match(/filename="([^"]*)"/i)
    if (fieldName === "course") {
      course = normalizeText(Buffer.from(contentBinary, "binary").toString("utf8"), "未分类课程")
      continue
    }
    if (fieldName === "displayName") {
      displayName = normalizeText(Buffer.from(contentBinary, "binary").toString("utf8"), "")
      continue
    }

    if (filenameMatch) {
      fileName = filenameMatch[1] || ""
      fileBuffer = Buffer.from(contentBinary, "binary")
    }
  }

  if (!fileBuffer || !fileName) {
    ctx.errMsg = "未检测到上传文件"
    return next()
  }

  const safeCourse = sanitizeCourseName(course)
  const safeFileName = sanitizeFileName(fileName)
  const ext = path.extname(safeFileName).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) {
    ctx.errMsg = `不支持的文件类型: ${ext || "unknown"}`
    return next()
  }

  const targetDir = path.resolve(MATERIALS_ROOT, safeCourse)
  if (!targetDir.startsWith(MATERIALS_ROOT)) {
    ctx.errMsg = "课程目录非法"
    return next()
  }
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const baseName = path.basename(safeFileName, ext)
  let finalName = safeFileName
  let targetPath = path.join(targetDir, finalName)
  let counter = 1
  while (fs.existsSync(targetPath)) {
    finalName = `${baseName}_${counter}${ext}`
    targetPath = path.join(targetDir, finalName)
    counter += 1
  }

  fs.writeFileSync(targetPath, fileBuffer)

  const relativePath = path.relative(MATERIALS_ROOT, targetPath).replace(/\\/g, "/")
  const finalDisplayName = normalizeText(displayName, path.basename(safeFileName, ext))
  setMetaByRelativePath(relativePath, {
    uploader,
    displayName: finalDisplayName,
  })

  ctx.result = {
    id: stableResourceId(relativePath),
    course: safeCourse,
    fileName: finalName,
    displayName: finalDisplayName,
    uploader,
    relativePath,
    url: `/materials/${encodeURI(relativePath)}`,
    size: fileBuffer.length,
  }
  return next()
}

const deleteFile = async (ctx, next) => {
  const uploader = getUploaderFromToken(ctx)
  if (!uploader) {
    ctx.errMsg = "请先登录后再删除"
    return next()
  }

  const resourceId = String((ctx.params && ctx.params.id) || "").trim()
  if (!resourceId) {
    ctx.errMsg = "资源ID不能为空"
    return next()
  }

  const list = buildResourceList()
  const target = list.find((item) => item.id === resourceId)
  if (!target) {
    ctx.errMsg = "资源不存在"
    return next()
  }

  if (target.owner !== uploader) {
    ctx.errMsg = "仅发布者可删除该文件"
    return next()
  }

  const fullPath = path.resolve(MATERIALS_ROOT, target.relativePath || "")
  if (!fullPath.startsWith(MATERIALS_ROOT)) {
    ctx.errMsg = "资源路径非法"
    return next()
  }
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    fs.unlinkSync(fullPath)
  }
  removeMetaByRelativePath(target.relativePath)

  ctx.result = {
    deleted: true,
    id: resourceId,
  }
  return next()
}

module.exports = {
  getList,
  uploadFile,
  deleteFile,
}
