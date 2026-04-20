require("dotenv").config()
const Koa = require("koa")
const bodyParser = require("koa-bodyparser")
const helmet = require("koa-helmet")
const path = require("path")
const fs = require("fs")

const { loggerMiddleware } = require("./middlewares/logger")
const { responseHandler, errorHandler } = require("./middlewares/response")

const app = new Koa()

app.use(loggerMiddleware)

// Error Handler
app.use(errorHandler)

// middlewares
app.use(bodyParser())
app.use(helmet())

// Static resource files (course materials download)
const materialsDir = path.resolve(__dirname, "public", "materials")
if (!fs.existsSync(materialsDir)) {
  fs.mkdirSync(materialsDir, { recursive: true })
}
app.use(async (ctx, next) => {
  if (!ctx.path.startsWith("/materials/")) {
    return next()
  }

  const relative = decodeURIComponent(ctx.path.replace(/^\/materials\//, ""))
  const targetPath = path.resolve(materialsDir, relative)
  if (!targetPath.startsWith(materialsDir)) {
    ctx.status = 403
    ctx.body = "Forbidden"
    return
  }

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    ctx.status = 404
    ctx.body = "Not Found"
    return
  }

  const ext = path.extname(targetPath).toLowerCase()
  const contentTypeMap = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".7z": "application/x-7z-compressed",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  }

  const filename = path.basename(targetPath)
  ctx.set("Content-Type", contentTypeMap[ext] || "application/octet-stream")
  ctx.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  ctx.body = fs.createReadStream(targetPath)
})

// routers
const indexRouter = require("./routes/index")
const dataRouter = require("./routes/data")

app.use(indexRouter.routes(), indexRouter.allowedMethods())
app.use(dataRouter.routes(), dataRouter.allowedMethods())

// Response
app.use(responseHandler)

module.exports = app
