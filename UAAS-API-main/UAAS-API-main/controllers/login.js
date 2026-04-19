const crypto = require("crypto")

function buildLocalToken(stuId) {
  const random = crypto.randomBytes(8).toString("hex")
  return `xjtu-${stuId}-${Date.now()}-${random}`
}

// XJTU mode: mini-program login only stores account/password and returns a local token.
// Real school auth is done by Playwright crawler with the same credentials.
const login = async (ctx, next) => {
  const { stuId, password } = ctx.request.body || {}
  const safeStuId = String(stuId || "").trim()
  const safePassword = String(password || "").trim()

  if (!safeStuId || !safePassword) {
    ctx.errMsg = "学号和密码不能为空"
    return next()
  }

  ctx.result = {
    cookie: buildLocalToken(safeStuId),
  }
  return next()
}

// Keep verify endpoints for compatibility with existing frontend routes.
const loginInit = async (ctx, next) => {
  ctx.result = {
    cookie: "",
    formData: {},
  }
  return next()
}

const loginVerifyCode = async (ctx, next) => {
  ctx.errMsg = "当前模式无需验证码"
  return next()
}

const loginWithVerify = async (ctx, next) => {
  return login(ctx, next)
}

module.exports = {
  loginInit,
  loginVerifyCode,
  login,
  loginWithVerify,
}
